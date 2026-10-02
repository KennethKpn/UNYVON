-- ============================================================================
-- UNYVON — SMART DATA IMPORT PHASE 5A
-- Materialisation transactionnelle : extraction validée -> import_items.
--
-- Aucun écrit métier (products/categories/customers/suppliers) ici.
-- La fonction est SECURITY INVOKER : RLS reste active. Elle vérifie néanmoins
-- explicitement auth.uid() + rôle owner/manager comme défense en profondeur.
--
-- Idempotence : si le document est déjà extracted, la fonction ne recrée pas
-- les items ; elle retourne les lignes déjà matérialisées. Si la transaction
-- échoue, tous les inserts + changements d'état sont annulés.
-- ============================================================================

begin;

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

  if p_document_id is null then
    raise exception 'Identifiant document requis';
  end if;

  if p_candidates is null or pg_catalog.jsonb_typeof(p_candidates) <> 'array' then
    raise exception 'Les candidats d''import doivent être un tableau JSON';
  end if;

  if pg_catalog.jsonb_array_length(p_candidates) > 500 then
    raise exception 'Trop de candidats pour un document (maximum 500)';
  end if;

  select *
    into v_document
    from public.import_documents
   where id = p_document_id;

  if not found then
    raise exception 'Document d''import introuvable';
  end if;

  if public.current_org_role(v_document.organization_id) not in ('owner', 'manager') then
    raise exception 'Seuls les propriétaires et managers peuvent matérialiser un import';
  end if;

  -- Un seul ordre de verrouillage : session puis document.
  -- Cela évite les cycles de verrous entre deux documents traités en parallèle.
  select *
    into v_session
    from public.import_sessions
   where id = v_document.session_id
   for update;

  if not found then
    raise exception 'Session d''import introuvable';
  end if;

  select *
    into v_document
    from public.import_documents
   where id = p_document_id
   for update;

  if v_document.state = 'extracted' then
    return query
      select i.*
        from public.import_items i
       where i.document_id = p_document_id
       order by i.created_at, i.id;
    return;
  end if;

  if v_session.state not in ('processing', 'needs_review') then
    raise exception
      'Matérialisation autorisée pendant le traitement/review uniquement (session: %)',
      v_session.state;
  end if;

  if v_document.state <> 'uploaded' then
    raise exception
      'Matérialisation autorisée uniquement depuis uploaded (état: %)',
      v_document.state;
  end if;

  if p_page_count is not null and p_page_count < 0 then
    raise exception 'page_count invalide';
  end if;

  -- Validation minimale et déterministe de la frontière RPC.
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
    if pg_catalog.jsonb_typeof(v_fields) <> 'object' or not (v_fields ? 'name') then
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
    (candidate->>'entity_type')::public.import_entity_type,
    case
      when candidate ? 'source_page'
       and pg_catalog.jsonb_typeof(candidate->'source_page') <> 'null'
      then (candidate->>'source_page')::integer
      else null
    end,
    candidate->'fields',
    null,
    'create',
    'pending',
    null
  from pg_catalog.jsonb_array_elements(p_candidates) as expanded(candidate);

  -- Les états documentaires sont franchis dans la même transaction que les items.
  update public.import_documents
     set state = 'parsing',
         page_count = p_page_count,
         error_message = null
   where id = v_document.id;

  update public.import_documents
     set state = 'parsed'
   where id = v_document.id;

  update public.import_documents
     set state = 'extracting'
   where id = v_document.id;

  update public.import_documents
     set state = 'extracted',
         processed_at = pg_catalog.clock_timestamp()
   where id = v_document.id;

  -- Le dernier document extrait clôt automatiquement le processing.
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

revoke execute on function public.materialize_import_document(uuid, jsonb, integer) from public, anon;
grant execute on function public.materialize_import_document(uuid, jsonb, integer) to authenticated;

commit;
