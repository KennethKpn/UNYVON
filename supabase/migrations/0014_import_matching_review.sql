-- ============================================================================
-- UNYVON — SMART DATA IMPORT PHASE 5B
-- Matching déterministe + décisions utilisateur.
--
-- Le matching proposé n'écrit jamais dans les tables métier.
-- Les UUID de cibles sont revalidés contre l'organisation + le type d'entité.
-- Les noms de cibles sont lus en base : une valeur fournie par le client n'est
-- jamais acceptée comme vérité.
-- ============================================================================

begin;

create or replace function public.apply_import_matches(
  p_session_id uuid,
  p_matches jsonb
)
returns setof public.import_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_session public.import_sessions%rowtype;
  v_item public.import_items%rowtype;
  v_match jsonb;
  v_item_id uuid;
  v_existing_id uuid;
  v_existing_text text;
  v_existing_name text;
  v_score numeric;
  v_reason text;
begin
  if v_user_id is null then
    raise exception 'Non authentifié';
  end if;

  if p_session_id is null then
    raise exception 'Identifiant de session requis';
  end if;

  if p_matches is null or pg_catalog.jsonb_typeof(p_matches) <> 'array' then
    raise exception 'Les propositions de matching doivent être un tableau JSON';
  end if;

  if pg_catalog.jsonb_array_length(p_matches) > 500 then
    raise exception 'Trop de propositions de matching (maximum 500)';
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
    raise exception 'Seuls les propriétaires et managers peuvent rapprocher un import';
  end if;

  if v_session.state not in ('processing', 'needs_review') then
    raise exception
      'Matching autorisé pendant le traitement/review uniquement (session: %)',
      v_session.state;
  end if;

  for v_match in
    select value from pg_catalog.jsonb_array_elements(p_matches)
  loop
    if pg_catalog.jsonb_typeof(v_match) <> 'object' then
      raise exception 'Chaque proposition doit être un objet JSON';
    end if;

    if (v_match->>'item_id') is null or
       not ((v_match->>'item_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
    then
      raise exception 'item_id invalide dans une proposition';
    end if;
    v_item_id := (v_match->>'item_id')::uuid;

    select *
      into v_item
      from public.import_items
     where id = v_item_id
       and session_id = v_session.id
       and organization_id = v_session.organization_id
     for update;

    if not found then
      raise exception 'Item de matching introuvable dans cette session';
    end if;

    if v_item.status = 'imported' then
      raise exception 'Un item déjà importé ne peut plus être rematché';
    end if;

    v_existing_text := nullif(v_match->>'existing_id', '');
    v_existing_id := null;

    if v_existing_text is not null then
      if not (v_existing_text ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then
        raise exception 'existing_id invalide';
      end if;
      v_existing_id := v_existing_text::uuid;
    end if;

    if pg_catalog.jsonb_typeof(v_match->'score') not in ('number') then
      raise exception 'score de matching invalide';
    end if;
    v_score := (v_match->>'score')::numeric;
    if v_score < 0 or v_score > 1 then
      raise exception 'score de matching hors limites';
    end if;

    v_reason := nullif(left(coalesce(v_match->>'reason', ''), 500), '');

    v_existing_name := null;
    if v_existing_id is not null then
      if v_item.entity_type = 'category' then
        select name into v_existing_name
          from public.categories
         where id = v_existing_id
           and organization_id = v_session.organization_id;
      elsif v_item.entity_type = 'product' then
        select name into v_existing_name
          from public.products
         where id = v_existing_id
           and organization_id = v_session.organization_id;
      elsif v_item.entity_type = 'customer' then
        select name into v_existing_name
          from public.customers
         where id = v_existing_id
           and organization_id = v_session.organization_id;
      elsif v_item.entity_type = 'supplier' then
        select name into v_existing_name
          from public.suppliers
         where id = v_existing_id
           and organization_id = v_session.organization_id;
      end if;

      if v_existing_name is null then
        raise exception
          'Cible de matching introuvable dans la même organisation pour le type %',
          v_item.entity_type;
      end if;
    end if;

    update public.import_items
       set match = jsonb_build_object(
         'existing_id', v_existing_id,
         'existing_name', v_existing_name,
         'score', v_score,
         'reason', v_reason
       )
     where id = v_item.id;
  end loop;

  return query
    select i.*
      from public.import_items i
     where i.session_id = v_session.id
     order by i.created_at, i.id;
end;
$$;

revoke execute on function public.apply_import_matches(uuid, jsonb) from public, anon;
grant execute on function public.apply_import_matches(uuid, jsonb) to authenticated;

create or replace function public.set_import_item_decision(
  p_item_id uuid,
  p_action public.import_item_action,
  p_existing_id uuid default null
)
returns public.import_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_session public.import_sessions%rowtype;
  v_item public.import_items%rowtype;
  v_existing_name text;
begin
  if v_user_id is null then
    raise exception 'Non authentifié';
  end if;

  if p_item_id is null then
    raise exception 'Identifiant item requis';
  end if;

  select s.*
    into v_session
    from public.import_sessions s
    join public.import_items i
      on i.session_id = s.id
   where i.id = p_item_id
   for update of s;

  if not found then
    raise exception 'Item d''import introuvable';
  end if;

  if public.current_org_role(v_session.organization_id) not in ('owner', 'manager') then
    raise exception 'Seuls les propriétaires et managers peuvent valider un import';
  end if;

  if v_session.state <> 'needs_review' then
    raise exception
      'Décision utilisateur autorisée uniquement pendant la revue (session: %)',
      v_session.state;
  end if;

  select *
    into v_item
    from public.import_items
   where id = p_item_id
     and session_id = v_session.id
     and organization_id = v_session.organization_id
   for update;

  if v_item.status = 'imported' then
    raise exception 'Un item déjà importé ne peut plus être modifié';
  end if;

  if p_action in ('use_existing', 'update') and p_existing_id is null then
    raise exception 'Une cible existante est requise pour cette décision';
  end if;

  if p_action in ('create', 'ignore') and p_existing_id is not null then
    raise exception 'Aucune cible existante ne doit accompagner cette décision';
  end if;

  v_existing_name := null;
  if p_existing_id is not null then
    if v_item.entity_type = 'category' then
      select name into v_existing_name
        from public.categories
       where id = p_existing_id
         and organization_id = v_session.organization_id;
    elsif v_item.entity_type = 'product' then
      select name into v_existing_name
        from public.products
       where id = p_existing_id
         and organization_id = v_session.organization_id;
    elsif v_item.entity_type = 'customer' then
      select name into v_existing_name
        from public.customers
       where id = p_existing_id
         and organization_id = v_session.organization_id;
    elsif v_item.entity_type = 'supplier' then
      select name into v_existing_name
        from public.suppliers
       where id = p_existing_id
         and organization_id = v_session.organization_id;
    end if;

    if v_existing_name is null then
      raise exception 'Cible existante invalide ou hors organisation';
    end if;
  end if;

  update public.import_items
     set action = p_action,
         status = case when p_action = 'ignore' then 'ignored' else 'validated' end,
         match = case
           when p_existing_id is null then null
           else jsonb_build_object(
             'existing_id', p_existing_id,
             'existing_name', v_existing_name,
             'score', 1,
             'reason', 'Choix explicite de l''utilisateur'
           )
         end,
         error_message = null
   where id = v_item.id;

  return (
    select i
      from public.import_items i
     where i.id = v_item.id
  );
end;
$$;

revoke execute on function public.set_import_item_decision(uuid, public.import_item_action, uuid) from public, anon;
grant execute on function public.set_import_item_decision(uuid, public.import_item_action, uuid) to authenticated;

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
