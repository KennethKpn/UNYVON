-- ============================================================================
-- UNYVON — SMART DATA IMPORT — 0027 extraction liveness lease
-- ============================================================================
-- Ferme la dernière fenêtre de blocage des documents en parsing/extracting :
--   * un worker obtient un lease serveur de 10 minutes ;
--   * l'expiration permet une reprise explicite et contrôlée ;
--   * processing_lease_id fence les anciens workers afin qu'ils ne puissent
--     plus finaliser ou libérer un document repris ;
--   * la capacité IA ignore uniquement les leases expirés après les avoir
--     neutralisés sous verrou organisationnel.
--
-- Le TTL est serveur, fixe et volontairement non paramétrable par le client.
-- ============================================================================

begin;

alter table public.import_documents
  add column if not exists processing_lease_id uuid,
  add column if not exists processing_lease_expires_at timestamptz;

create index if not exists import_documents_extraction_lease_idx
  on public.import_documents (
    organization_id,
    state,
    processing_lease_expires_at
  );

-- Les documents déjà bloqués au moment du déploiement reçoivent un délai de
-- grâce contrôlé. Le nouveau lease_id fence tout worker antérieur au déploiement.
update public.import_documents
   set processing_lease_id = pg_catalog.gen_random_uuid(),
       processing_lease_expires_at = pg_catalog.clock_timestamp() + interval '10 minutes'
 where state in ('parsing', 'extracting')
   and (
     processing_lease_id is null
     or processing_lease_expires_at is null
   );

comment on column public.import_documents.processing_lease_id
is 'Jeton de fencing du worker d''extraction courant ; nul hors parsing/extracting.';

comment on column public.import_documents.processing_lease_expires_at
is 'Expiration du lease d''extraction serveur ; TTL fixe de 10 minutes.';

-- ---------------------------------------------------------------------------
-- 1. Claim initial : uploaded → parsing
-- ---------------------------------------------------------------------------

create or replace function public.claim_import_parsing_lease(
  p_document_id uuid
)
returns public.import_documents
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_document public.import_documents%rowtype;
  v_session public.import_sessions%rowtype;
  v_lease_id uuid;
  v_lease_ttl constant interval := interval '10 minutes';
begin
  if v_user_id is null then
    raise exception 'Non authentifié';
  end if;

  select *
    into v_document
    from public.import_documents
   where id = p_document_id
   for update;

  if not found then
    raise exception 'Document d''import introuvable';
  end if;

  if public.current_org_role(v_document.organization_id) not in ('owner', 'manager') then
    raise exception 'Seuls les propriétaires et managers peuvent gérer les imports';
  end if;

  select *
    into v_session
    from public.import_sessions
   where id = v_document.session_id
     and organization_id = v_document.organization_id
   for update;

  if not found then
    raise exception 'Session d''import introuvable';
  end if;

  if v_session.state not in ('processing', 'needs_review') then
    raise exception
      'Lecture locale autorisée pendant le traitement/review uniquement (session: %)',
      v_session.state;
  end if;

  if v_document.state <> 'uploaded' then
    raise exception
      'Réservation de lecture autorisée uniquement depuis uploaded (état: %)',
      v_document.state;
  end if;

  v_lease_id := pg_catalog.gen_random_uuid();

  update public.import_documents
     set state = 'parsing',
         processing_lease_id = v_lease_id,
         processing_lease_expires_at = pg_catalog.clock_timestamp() + v_lease_ttl,
         error_message = null
   where id = v_document.id
     and state = 'uploaded'
   returning * into v_document;

  if not found then
    raise exception
      'Document modifié en parallèle : réservation de lecture annulée';
  end if;

  return v_document;
end;
$$;

revoke execute on function public.claim_import_parsing_lease(uuid) from public, anon;
grant execute on function public.claim_import_parsing_lease(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Claim extraction : parsed → extracting
--    + neutralisation des leases expirés de la même organisation.
-- ---------------------------------------------------------------------------

create or replace function public.claim_import_extraction_slot(
  p_document_id uuid
)
returns public.import_documents
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_document public.import_documents%rowtype;
  v_session public.import_sessions%rowtype;
  v_active integer;
  v_limit constant integer := 2;
  v_lease_ttl constant interval := interval '10 minutes';
begin
  if v_user_id is null then
    raise exception 'Non authentifié';
  end if;

  select *
    into v_document
    from public.import_documents
   where id = p_document_id
   for update;

  if not found then
    raise exception 'Document d''import introuvable';
  end if;

  if public.current_org_role(v_document.organization_id) not in ('owner', 'manager') then
    raise exception 'Seuls les propriétaires et managers peuvent gérer les imports';
  end if;

  select *
    into v_session
    from public.import_sessions
   where id = v_document.session_id
     and organization_id = v_document.organization_id
   for update;

  if not found then
    raise exception 'Session d''import introuvable';
  end if;

  if v_document.state <> 'parsed' then
    raise exception
      'Réservation IA autorisée uniquement depuis parsed (état: %)',
      v_document.state;
  end if;

  if v_session.state not in ('processing', 'needs_review') then
    raise exception
      'Réservation IA autorisée pendant le traitement/review uniquement (session: %)',
      v_session.state;
  end if;

  -- Toutes les réservations IA de l'organisation passent par le même verrou.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_document.organization_id::text, 0)
  );

  -- Une expiration est une reprise contrôlée : le prochain claim fence
  -- l'ancien worker en retirant son lease avant de compter la capacité.
  update public.import_documents
     set state = case
       when parsed_artifact is not null
         then 'parsed'::public.import_document_state
       else 'uploaded'::public.import_document_state
     end,
         processing_lease_id = null,
         processing_lease_expires_at = null,
         error_message = 'Extraction précédente abandonnée après expiration du bail ; reprise autorisée.'
   where organization_id = v_document.organization_id
     and state = 'extracting'
     and processing_lease_expires_at is not null
     and processing_lease_expires_at <= pg_catalog.clock_timestamp();

  -- La session peut avoir changé pendant l'attente du verrou organisationnel.
  select *
    into v_session
    from public.import_sessions
   where id = v_document.session_id
     and organization_id = v_document.organization_id
   for update;

  if not found then
    raise exception 'Session d''import introuvable';
  end if;

  if v_session.state not in ('processing', 'needs_review') then
    raise exception
      'Réservation IA annulée : session devenue inactive (état: %)',
      v_session.state;
  end if;

  select count(*)
    into v_active
    from public.import_documents
   where organization_id = v_document.organization_id
     and state = 'extracting'
     and (
       processing_lease_id is null
       or processing_lease_expires_at is null
       or processing_lease_expires_at > pg_catalog.clock_timestamp()
     );

  if v_active >= v_limit then
    raise exception
      'CAPACITE_EXTRACTION_ATTEINTE: limite de % extractions IA simultanées pour cette organisation',
      v_limit;
  end if;

  -- Le document cible peut avoir été modifié avant le verrou organisationnel.
  select *
    into v_document
    from public.import_documents
   where id = p_document_id
   for update;

  if not found then
    raise exception 'Document d''import introuvable';
  end if;

  if v_document.state <> 'parsed' then
    raise exception
      'Réservation IA annulée : document devenu inaccessible (état: %)',
      v_document.state;
  end if;

  v_document.processing_lease_id := pg_catalog.gen_random_uuid();
  v_document.processing_lease_expires_at :=
    pg_catalog.clock_timestamp() + v_lease_ttl;

  update public.import_documents
     set state = 'extracting',
         processing_lease_id = v_document.processing_lease_id,
         processing_lease_expires_at = v_document.processing_lease_expires_at,
         error_message = null
   where id = v_document.id
     and organization_id = v_document.organization_id
     and state = 'parsed'
   returning * into v_document;

  if not found then
    raise exception
      'Document modifié en parallèle : réservation IA annulée pour protéger son nouvel état';
  end if;

  return v_document;
end;
$$;

revoke execute on function public.claim_import_extraction_slot(uuid) from public, anon;
grant execute on function public.claim_import_extraction_slot(uuid) to authenticated;

comment on function public.claim_import_extraction_slot(uuid)
is 'Réserve atomiquement un slot d''extraction IA par organisation, avec lease serveur fixe de 10 minutes et fencing des leases expirés.';

-- ---------------------------------------------------------------------------
-- 3. Reprise contrôlée d'un document bloqué
-- ---------------------------------------------------------------------------

create or replace function public.recover_stale_import_document(
  p_document_id uuid
)
returns public.import_documents
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_document public.import_documents%rowtype;
  v_session public.import_sessions%rowtype;
  v_next_state public.import_document_state;
begin
  if v_user_id is null then
    raise exception 'Non authentifié';
  end if;

  select *
    into v_document
    from public.import_documents
   where id = p_document_id
   for update;

  if not found then
    raise exception 'Document d''import introuvable';
  end if;

  if public.current_org_role(v_document.organization_id) not in ('owner', 'manager') then
    raise exception 'Seuls les propriétaires et managers peuvent gérer les imports';
  end if;

  select *
    into v_session
    from public.import_sessions
   where id = v_document.session_id
     and organization_id = v_document.organization_id
   for update;

  if not found then
    raise exception 'Session d''import introuvable';
  end if;

  if v_session.state <> 'processing' then
    raise exception
      'Reprise d''un document bloqué autorisée pendant le traitement uniquement (session: %)',
      v_session.state;
  end if;

  if v_document.state not in ('parsing', 'extracting') then
    raise exception
      'Aucune reprise de liveness nécessaire depuis l''état %',
      v_document.state;
  end if;

  if v_document.processing_lease_expires_at is null
     or v_document.processing_lease_expires_at > pg_catalog.clock_timestamp()
  then
    raise exception
      'Lease encore actif : reprise refusée tant que le traitement n''est pas expiré';
  end if;

  v_next_state :=
    case
      when v_document.state = 'extracting' and v_document.parsed_artifact is not null
        then 'parsed'::public.import_document_state
      else 'uploaded'::public.import_document_state
    end;

  -- Reprise = clear du fencing précédent. Un worker qui revient après coup ne
  -- pourra plus passer les vérifications de lease des étapes suivantes.
  update public.import_documents
     set state = v_next_state,
         processing_lease_id = null,
         processing_lease_expires_at = null,
         error_message = 'Traitement précédent interrompu après expiration du bail ; reprise autorisée.'
   where id = v_document.id
     and state = v_document.state;

  select *
    into v_document
    from public.import_documents
   where id = v_document.id;

  return v_document;
end;
$$;

revoke execute on function public.recover_stale_import_document(uuid) from public, anon;
grant execute on function public.recover_stale_import_document(uuid) to authenticated;

comment on function public.recover_stale_import_document(uuid)
is 'Reprend explicitement un document dont le lease parsing/extracting est expiré, avec fencing du worker précédent.';

-- ---------------------------------------------------------------------------
-- 4. Matérialisation : lease obligatoire pour tout worker extracting
-- ---------------------------------------------------------------------------

create or replace function public.materialize_import_document(
  p_document_id uuid,
  p_candidates jsonb,
  p_page_count integer
)
returns setof public.import_items
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception
    'Lease d''extraction requis : utilisez materialize_import_document(uuid, jsonb, integer, uuid)';
end;
$$;

revoke execute on function public.materialize_import_document(uuid, jsonb, integer) from public, anon;
grant execute on function public.materialize_import_document(uuid, jsonb, integer) to authenticated;

create or replace function public.materialize_import_document(
  p_document_id uuid,
  p_candidates jsonb,
  p_page_count integer,
  p_lease_id uuid
)
returns setof public.import_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_document public.import_documents%rowtype;
  v_session public.import_sessions%rowtype;
  v_candidate jsonb;
  v_fields jsonb;
  v_entity text;
  v_key text;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Non authentifié';
  end if;

  if p_lease_id is null then
    raise exception 'Lease d''extraction requis';
  end if;

  if p_document_id is null then
    raise exception 'Identifiant document requis';
  end if;

  select *
    into v_session
    from public.import_sessions
   where id = (
     select d.session_id
       from public.import_documents d
      where d.id = p_document_id
   )
   for update;

  if not found then
    raise exception 'Session d''import introuvable';
  end if;

  select *
    into v_document
    from public.import_documents
   where id = p_document_id
     and session_id = v_session.id
   for update;

  if not found then
    raise exception 'Document d''import introuvable';
  end if;

  if public.current_org_role(v_document.organization_id) not in ('owner', 'manager') then
    raise exception 'Seuls les propriétaires et managers peuvent matérialiser un import';
  end if;

  if v_session.state not in ('processing', 'needs_review') then
    raise exception
      'Matérialisation autorisée pendant le traitement/review uniquement (session: %)',
      v_session.state;
  end if;

  if v_document.state = 'extracted' then
    return query
      select i.*
        from public.import_items i
       where i.document_id = p_document_id
       order by i.created_at, i.id;
    return;
  end if;

  if v_document.state <> 'extracting'
     or v_document.processing_lease_id is distinct from p_lease_id
     or v_document.processing_lease_expires_at is null
     or v_document.processing_lease_expires_at <= pg_catalog.clock_timestamp()
  then
    raise exception
      'Lease d''extraction invalide, expiré ou remplacé : matérialisation refusée';
  end if;

  if p_candidates is null or pg_catalog.jsonb_typeof(p_candidates) <> 'array' then
    raise exception 'Les candidats d''import doivent être un tableau JSON';
  end if;

  if pg_catalog.jsonb_array_length(p_candidates) > 500 then
    raise exception 'Trop de candidats pour un document (maximum 500)';
  end if;

  if p_page_count is not null and p_page_count < 0 then
    raise exception 'page_count invalide';
  end if;

  for v_candidate in
    select value
      from pg_catalog.jsonb_array_elements(p_candidates)
  loop
    if pg_catalog.jsonb_typeof(v_candidate) <> 'object' then
      raise exception 'Chaque candidat doit être un objet JSON';
    end if;

    v_entity := v_candidate->>'entity_type';

          if v_entity not in ('category', 'product', 'customer', 'supplier') then
      raise exception 'Type d''entité de candidat invalide';
    end if;

    v_fields := v_candidate->'fields';

    if pg_catalog.jsonb_typeof(v_fields) <> 'object'
       or not (v_fields ? 'name')
    then
      raise exception 'Le candidat doit contenir un objet fields avec name';
    end if;

    if pg_catalog.jsonb_typeof(v_fields->'name') <> 'object'
       or pg_catalog.jsonb_typeof(v_fields->'name'->'raw') <> 'string'
       or pg_catalog.jsonb_typeof(v_fields->'name'->'confidence') <> 'string'
       or (v_fields->'name'->>'confidence') not in ('high', 'medium', 'low', 'missing')
    then
      raise exception 'Provenance du champ name invalide';
    end if;

    if v_candidate ? 'source_page'
       and v_candidate->'source_page' is not null
       and pg_catalog.jsonb_typeof(v_candidate->'source_page') <> 'null'
    then
      if pg_catalog.jsonb_typeof(v_candidate->'source_page') <> 'number'
         or mod((v_candidate->>'source_page')::numeric, 1) <> 0
         or (v_candidate->>'source_page')::integer < 1
      then
        raise exception 'source_page invalide';
      end if;
    end if;

    for v_key in
      select key from pg_catalog.jsonb_object_keys(v_fields) as key
    loop
      if (v_entity = 'category' and v_key not in ('name'))
         or (v_entity = 'product' and v_key not in ('name', 'unit', 'cost_price', 'sale_price', 'min_stock_threshold', 'category'))
         or (v_entity = 'customer' and v_key not in ('name', 'phone', 'email', 'address', 'notes'))
         or (v_entity = 'supplier' and v_key not in ('name', 'phone', 'email', 'address', 'notes'))
      then
        raise exception 'Champ hors contrat pour l''entité %: %', v_entity, v_key;
      end if;
    end loop;
  end loop;

  insert into public.import_items (
    session_id,
    document_id,
    organization_id,
    entity_type,
    source_page,
    fields,
    match,
    action,
    status,
    error_message
  )
  select
    v_session.id,
    v_document.id,
    v_document.organization_id,
    (coalesce(candidate->>'entity_type', candidate->>'entityType'))::public.import_entity_type,
    case
      when candidate ? 'source_page'
       and pg_catalog.jsonb_typeof(candidate->'source_page') <> 'null'
      then (candidate->>'source_page')::integer
      when candidate ? 'page'
       and pg_catalog.jsonb_typeof(candidate->'page') <> 'null'
      then (candidate->>'page')::integer
      else null
    end,
    candidate->'fields',
    null,
    'create',
    'pending',
    null
  from pg_catalog.jsonb_array_elements(p_candidates) as expanded(candidate);

  update public.import_documents
     set state = 'extracted',
         page_count = coalesce(p_page_count, v_document.page_count),
         processed_at = pg_catalog.clock_timestamp(),
         error_message = null,
         processing_lease_id = null,
         processing_lease_expires_at = null
   where id = v_document.id
     and organization_id = v_document.organization_id
     and state = 'extracting'
     and processing_lease_id = p_lease_id
     and processing_lease_expires_at > pg_catalog.clock_timestamp();

  if not found then
    raise exception
      'Lease d''extraction perdu pendant la matérialisation : résultat refusé';
  end if;

  if not exists (
    select 1
      from public.import_documents d
     where d.session_id = v_session.id
       and d.state <> 'extracted'
  ) then
    update public.import_sessions
       set state = 'needs_review'
     where id = v_session.id
       and state = 'processing';
  end if;

  return query
    select i.*
      from public.import_items i
     where i.document_id = v_document.id
     order by i.created_at, i.id;
end;
$$;

revoke execute on function public.materialize_import_document(uuid, jsonb, integer, uuid) from public, anon;
grant execute on function public.materialize_import_document(uuid, jsonb, integer, uuid) to authenticated;

comment on function public.materialize_import_document(uuid, jsonb, integer, uuid)
is 'Matérialise uniquement sous le lease d''extraction courant ; les anciens workers sont fenceés.';

commit;
