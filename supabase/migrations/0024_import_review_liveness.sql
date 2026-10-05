-- ============================================================================
-- UNYVON — SMART DATA IMPORT — 0024 review liveness hardening
-- ============================================================================
-- finalize_import_review doit être une vraie barrière transactionnelle :
--   * aucune revue ne devient "ready" tant qu'un document n'est pas extracted ;
--   * une suppression d'un document échoué ne peut donc pas masquer une source
--     encore incomplète ;
--   * les contrôles restent SECURITY INVOKER + rôle owner/manager.
--
-- La vérification est côté PostgreSQL (et non seulement dans l'UI) afin qu'un
-- appel direct de la RPC ne puisse contourner la règle.
-- ============================================================================

begin;

create or replace function public.finalize_import_review(
  p_session_id uuid
)
returns public.import_sessions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_session public.import_sessions%rowtype;
  v_item_count integer;
begin
  if v_user_id is null then
    raise exception 'Non authentifié';
  end if;

  select *
    into v_session
    from public.import_sessions
   where id = p_session_id
   for update;

  if not found then
    raise exception 'Session d''import introuvable';
  end if;

  if public.current_org_role(v_session.organization_id) not in ('owner', 'manager') then
    raise exception 'Seuls les propriétaires et managers peuvent finaliser la revue';
  end if;

  if v_session.state = 'ready' then
    return v_session;
  end if;

  if v_session.state <> 'needs_review' then
    raise exception
      'Finalisation de revue autorisée depuis needs_review uniquement (état: %)',
      v_session.state;
  end if;

  -- Barrière serveur : la revue n'est complète que lorsque chaque source
  -- documentaire encore rattachée à la session a effectivement été extraite.
  if not exists (
    select 1
      from public.import_documents d
     where d.session_id = v_session.id
       and d.organization_id = v_session.organization_id
  ) then
    raise exception 'Impossible de finaliser une revue sans document';
  end if;

  if exists (
    select 1
      from public.import_documents d
     where d.session_id = v_session.id
       and d.organization_id = v_session.organization_id
       and d.state <> 'extracted'
  ) then
    raise exception 'Tous les documents doivent être extracted avant de finaliser la revue';
  end if;

  select count(*) into v_item_count
    from public.import_items
   where session_id = v_session.id
     and organization_id = v_session.organization_id;

  if v_item_count = 0 then
    raise exception 'Impossible de finaliser une revue sans item';
  end if;

  if exists (
    select 1
      from public.import_items
     where session_id = v_session.id
       and organization_id = v_session.organization_id
       and status not in ('validated', 'ignored')
  ) then
    raise exception 'Tous les items doivent être validés ou ignorés avant de continuer';
  end if;

  update public.import_sessions
     set state = 'ready'
   where id = v_session.id
     and state = 'needs_review'
   returning * into v_session;

  return v_session;
end;
$$;

revoke execute on function public.finalize_import_review(uuid) from public, anon;
grant execute on function public.finalize_import_review(uuid) to authenticated;

commit;
