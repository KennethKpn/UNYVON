-- ============================================================================
-- UNYVON — SMART DATA IMPORT — bounded AI extraction concurrency
-- ============================================================================
-- L'objectif est de limiter les appels fournisseur simultanés par organisation
-- sans introduire de file fragile en mémoire applicative.
--
-- Le verrou transactionnel PostgreSQL sérialise les réservations au niveau de
-- l'organisation. La limite est volontairement codée côté serveur (2) : elle
-- ne peut pas être augmentée par un argument client.
-- ============================================================================

begin;

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
     and organization_id = v_document.organization_id;

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

  -- Toutes les réservations de cette organisation passent par le même
  -- verrou transactionnel. Deux transactions concurrentes ne peuvent donc
  -- pas observer simultanément une capacité disponible.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_document.organization_id::text, 0)
  );

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
     and state = 'extracting';

  if v_active >= v_limit then
    raise exception
      'CAPACITE_EXTRACTION_ATTEINTE: limite de % extractions IA simultanées pour cette organisation',
      v_limit;
  end if;

  update public.import_documents
     set state = 'extracting',
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
is 'Réserve atomiquement un slot d''extraction IA par organisation, limite serveur fixe à 2.';

commit;
