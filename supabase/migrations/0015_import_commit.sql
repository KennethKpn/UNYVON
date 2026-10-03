-- ============================================================================
-- UNYVON — SMART DATA IMPORT PHASE 5C
-- Commit atomique : import_items -> tables métier.
--
-- Contrat non négociable :
--   * session READY uniquement ;
--   * auth + owner/manager vérifiés dans la fonction ;
--   * verrou session unique pour empêcher deux commits concurrents ;
--   * chaque target UUID est revalidé dans la même organisation + entity_type ;
--   * catégories créées/résolues avant les produits ;
--   * aucun UUID métier ne vient de l'IA ou d'un payload non revalidé ;
--   * toute erreur annule TOUT le commit et laisse la session READY/rejouable.
-- ============================================================================

begin;

create or replace function public.import_commit(
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
  v_item public.import_items%rowtype;
  v_fields jsonb;
  v_match jsonb;
  v_key text;
  v_field jsonb;
  v_existing_text text;
  v_existing_id uuid;
  v_existing_name text;
  v_name text;
  v_unit text;
  v_category_name text;
  v_category_id uuid;
  v_category_count integer;
  v_cost_price numeric;
  v_sale_price numeric;
  v_min_stock integer;
  v_phone text;
  v_email text;
  v_address text;
  v_notes text;
begin
  if v_user_id is null then
    raise exception 'Non authentifié';
  end if;

  if p_session_id is null then
    raise exception 'Identifiant de session requis';
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
    raise exception 'Seuls les propriétaires et managers peuvent committer un import';
  end if;

  if v_session.state <> 'ready' then
    raise exception
      'Commit autorisé uniquement depuis ready (état: %)',
      v_session.state;
  end if;

  if not exists (
    select 1
      from public.import_items i
     where i.session_id = v_session.id
       and i.organization_id = v_session.organization_id
  ) then
    raise exception 'Impossible de committer une session sans item';
  end if;

  if exists (
    select 1
      from public.import_documents d
     where d.session_id = v_session.id
       and d.organization_id = v_session.organization_id
       and d.state <> 'extracted'
  ) then
    raise exception 'Tous les documents doivent être extracted avant le commit';
  end if;

  if exists (
    select 1
      from public.import_items i
     where i.session_id = v_session.id
       and i.organization_id = v_session.organization_id
       and i.status not in ('validated', 'ignored')
  ) then
    raise exception 'Tous les items doivent être validés ou ignorés avant le commit';
  end if;

  -- Revalidation globale des contrats JSON avant toute écriture métier.
  for v_item in
    select i.*
      from public.import_items i
     where i.session_id = v_session.id
       and i.organization_id = v_session.organization_id
     order by i.id
  loop
    if v_item.action = 'ignore' and v_item.status <> 'ignored' then
      raise exception 'Item % incohérent : ignore doit avoir le statut ignored', v_item.id;
    end if;

    if v_item.action <> 'ignore' and v_item.status <> 'validated' then
      raise exception 'Item % incohérent : action métier exige le statut validated', v_item.id;
    end if;

    v_fields := v_item.fields;
    if pg_catalog.jsonb_typeof(v_fields) <> 'object'
       or not (v_fields ? 'name')
    then
      raise exception 'Item % : fields/name invalide', v_item.id;
    end if;

    for v_key in
      select key from pg_catalog.jsonb_object_keys(v_fields) as key
    loop
      v_field := v_fields->v_key;

      if pg_catalog.jsonb_typeof(v_field) <> 'object'
         or pg_catalog.jsonb_typeof(v_field->'raw') <> 'string'
         or pg_catalog.jsonb_typeof(v_field->'confidence') <> 'string'
         or (v_field->>'confidence') not in ('high', 'medium', 'low', 'missing')
      then
        raise exception 'Item % : provenance invalide pour le champ %', v_item.id, v_key;
      end if;

      if v_field ? 'normalized'
         and pg_catalog.jsonb_typeof(v_field->'normalized') not in ('string', 'number', 'null')
      then
        raise exception 'Item % : normalized invalide pour le champ %', v_item.id, v_key;
      end if;

      if (v_item.entity_type = 'category' and v_key not in ('name'))
         or (v_item.entity_type = 'product' and v_key not in ('name', 'unit', 'cost_price', 'sale_price', 'min_stock_threshold', 'category'))
         or (v_item.entity_type = 'customer' and v_key not in ('name', 'phone', 'email', 'address', 'notes'))
         or (v_item.entity_type = 'supplier' and v_key not in ('name', 'phone', 'email', 'address', 'notes'))
      then
        raise exception 'Item % : champ hors contrat pour %', v_item.id, v_key;
      end if;
    end loop;

    v_name := pg_catalog.trim(
      coalesce(v_fields->'name'->>'normalized', v_fields->'name'->>'raw', '')
    );

    if v_name = '' then
      raise exception 'Item % : nom vide', v_item.id;
    end if;

    -- Les actions create/use_existing/update ont des contraintes de cible strictes.
    if v_item.action in ('use_existing', 'update') then
      if pg_catalog.jsonb_typeof(v_item.match) <> 'object'
         or v_item.match->>'existing_id' is null
         or not ((v_item.match->>'existing_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
      then
        raise exception 'Item % : cible existante invalide', v_item.id;
      end if;
    elsif v_item.action = 'create' and v_item.match is not null then
      raise exception 'Item % : create ne doit pas conserver de cible existante', v_item.id;
    end if;
  end loop;

  -- Marque la session importing sous le verrou. Toute erreur qui suit provoque
  -- automatiquement le rollback PostgreSQL, y compris de cette transition.
  update public.import_sessions
     set state = 'importing'
   where id = v_session.id
     and state = 'ready';

  -- --------------------------------------------------------------------------
  -- 1. Catégories : les créations doivent exister avant les produits.
  -- --------------------------------------------------------------------------
  for v_item in
    select i.*
      from public.import_items i
     where i.session_id = v_session.id
       and i.organization_id = v_session.organization_id
     order by
       case i.entity_type
         when 'category' then 1
         when 'product' then 2
         when 'customer' then 3
         when 'supplier' then 4
       end,
       i.created_at,
       i.id
  loop
    if v_item.action = 'ignore' then
      continue;
    end if;

    v_fields := v_item.fields;
    v_name := pg_catalog.trim(
      coalesce(v_fields->'name'->>'normalized', v_fields->'name'->>'raw', '')
    );

    if v_item.entity_type = 'category' then
      if v_item.action = 'create' then
        insert into public.categories (organization_id, name)
        values (v_session.organization_id, v_name);

      elsif v_item.action in ('use_existing', 'update') then
        v_existing_id := (v_item.match->>'existing_id')::uuid;

        select c.name
          into v_existing_name
          from public.categories c
         where c.id = v_existing_id
           and c.organization_id = v_session.organization_id
         for update;

        if not found then
          raise exception 'Item % : catégorie cible absente de la même organisation', v_item.id;
        end if;

        if v_item.action = 'update' then
          update public.categories
             set name = v_name
           where id = v_existing_id
             and organization_id = v_session.organization_id;
        end if;
      end if;

    elsif v_item.entity_type = 'product' then
      -- create exige un prix de vente explicitement normalisé.
      -- update ne modifie QUE les champs réellement présents dans le
      -- document : aucune valeur par défaut ne doit écraser un existant.
      v_unit := null;
      v_cost_price := null;
      v_sale_price := null;
      v_min_stock := null;
      v_category_id := null;

      if v_item.action = 'create' then
        if not (v_fields ? 'sale_price')
           or pg_catalog.jsonb_typeof(v_fields->'sale_price'->'normalized') <> 'number'
        then
          raise exception 'Item % : sale_price requis et doit être une valeur numérique normalisée', v_item.id;
        end if;
        v_sale_price := (v_fields->'sale_price'->'normalized')::numeric;
        if v_sale_price < 0 then
          raise exception 'Item % : sale_price négatif', v_item.id;
        end if;

        v_unit := pg_catalog.trim(
          coalesce(v_fields->'unit'->>'normalized', v_fields->'unit'->>'raw', '')
        );
        if v_unit = '' then
          v_unit := 'unité';
        end if;

        v_cost_price := 0;
        if v_fields ? 'cost_price' then
          if pg_catalog.jsonb_typeof(v_fields->'cost_price'->'normalized') <> 'number' then
            raise exception 'Item % : cost_price doit être une valeur numérique normalisée', v_item.id;
          end if;
          v_cost_price := (v_fields->'cost_price'->'normalized')::numeric;
          if v_cost_price < 0 then
            raise exception 'Item % : cost_price négatif', v_item.id;
          end if;
        end if;

        v_min_stock := 0;
        if v_fields ? 'min_stock_threshold' then
          if pg_catalog.jsonb_typeof(v_fields->'min_stock_threshold'->'normalized') <> 'number'
             or mod((v_fields->'min_stock_threshold'->'normalized')::numeric, 1) <> 0
          then
            raise exception 'Item % : min_stock_threshold doit être un entier normalisé', v_item.id;
          end if;
          v_min_stock := (v_fields->'min_stock_threshold'->'normalized')::integer;
          if v_min_stock < 0 then
            raise exception 'Item % : min_stock_threshold négatif', v_item.id;
          end if;
        end if;

      elsif v_item.action = 'update' then
        if v_fields ? 'sale_price' then
          if pg_catalog.jsonb_typeof(v_fields->'sale_price'->'normalized') <> 'number' then
            raise exception 'Item % : sale_price doit être une valeur numérique normalisée', v_item.id;
          end if;
          v_sale_price := (v_fields->'sale_price'->'normalized')::numeric;
          if v_sale_price < 0 then
            raise exception 'Item % : sale_price négatif', v_item.id;
          end if;
        end if;

        if v_fields ? 'cost_price' then
          if pg_catalog.jsonb_typeof(v_fields->'cost_price'->'normalized') <> 'number' then
            raise exception 'Item % : cost_price doit être une valeur numérique normalisée', v_item.id;
          end if;
          v_cost_price := (v_fields->'cost_price'->'normalized')::numeric;
          if v_cost_price < 0 then
            raise exception 'Item % : cost_price négatif', v_item.id;
          end if;
        end if;

        if v_fields ? 'min_stock_threshold' then
          if pg_catalog.jsonb_typeof(v_fields->'min_stock_threshold'->'normalized') <> 'number'
             or mod((v_fields->'min_stock_threshold'->'normalized')::numeric, 1) <> 0
          then
            raise exception 'Item % : min_stock_threshold doit être un entier normalisé', v_item.id;
          end if;
          v_min_stock := (v_fields->'min_stock_threshold'->'normalized')::integer;
          if v_min_stock < 0 then
            raise exception 'Item % : min_stock_threshold négatif', v_item.id;
          end if;
        end if;

        if v_fields ? 'unit' then
          v_unit := pg_catalog.trim(
            coalesce(v_fields->'unit'->>'normalized', v_fields->'unit'->>'raw', '')
          );
          if v_unit = '' then
            raise exception 'Item % : unit fourni mais vide', v_item.id;
          end if;
        end if;
      end if;

      if v_fields ? 'category' then
        v_category_name := pg_catalog.trim(
          coalesce(v_fields->'category'->>'normalized', v_fields->'category'->>'raw', '')
        );

        if v_category_name = '' and v_item.action = 'update' then
          raise exception 'Item % : category fourni mais vide pour update', v_item.id;
        end if;

        if v_category_name <> '' then
          select count(*), min(c.id)
            into v_category_count, v_category_id
            from public.categories c
           where c.organization_id = v_session.organization_id
             and pg_catalog.lower(
               pg_catalog.regexp_replace(pg_catalog.trim(c.name), '[^[:alnum:]]+', ' ', 'g')
             ) =
                 pg_catalog.lower(
                   pg_catalog.regexp_replace(v_category_name, '[^[:alnum:]]+', ' ', 'g')
                 );

          if v_category_count = 0 then
            raise exception
              'Item % : catégorie "%" introuvable ; créez/validez la catégorie dans la revue',
              v_item.id,
              v_category_name;
          end if;

          if v_category_count > 1 then
            raise exception
              'Item % : catégorie "%" ambiguë dans cette organisation',
              v_item.id,
              v_category_name;
          end if;
        end if;
      end if;

      if v_item.action = 'create' then
        insert into public.products (
          organization_id,
          category_id,
          name,
          unit,
          cost_price,
          sale_price,
          min_stock_threshold
        )
        values (
          v_session.organization_id,
          v_category_id,
          v_name,
          v_unit,
          v_cost_price,
          v_sale_price,
          v_min_stock
        );

      elsif v_item.action in ('use_existing', 'update') then
        v_existing_id := (v_item.match->>'existing_id')::uuid;

        select p.id
          into v_existing_id
          from public.products p
         where p.id = v_existing_id
           and p.organization_id = v_session.organization_id
         for update;

        if not found then
          raise exception 'Item % : produit cible absent de la même organisation', v_item.id;
        end if;

        if v_item.action = 'use_existing' then
          null;
        else
          update public.products
           set name = v_name,
               unit = case when v_fields ? 'unit' then v_unit else unit end,
               cost_price = case when v_fields ? 'cost_price' then v_cost_price else cost_price end,
               sale_price = case when v_fields ? 'sale_price' then v_sale_price else sale_price end,
               min_stock_threshold = case
                 when v_fields ? 'min_stock_threshold' then v_min_stock
                 else min_stock_threshold
               end,
               category_id = case when v_fields ? 'category' then v_category_id else category_id end
         where id = v_existing_id
           and organization_id = v_session.organization_id;
      end if;

    elsif v_item.entity_type in ('customer', 'supplier') then
      v_phone := nullif(
        pg_catalog.trim(coalesce(v_fields->'phone'->>'normalized', v_fields->'phone'->>'raw', '')),
        ''
      );
      v_email := nullif(
        pg_catalog.trim(coalesce(v_fields->'email'->>'normalized', v_fields->'email'->>'raw', '')),
        ''
      );
      v_address := nullif(
        pg_catalog.trim(coalesce(v_fields->'address'->>'normalized', v_fields->'address'->>'raw', '')),
        ''
      );
      v_notes := nullif(
        pg_catalog.trim(coalesce(v_fields->'notes'->>'normalized', v_fields->'notes'->>'raw', '')),
        ''
      );

      if v_item.entity_type = 'customer' then
        if v_item.action = 'create' then
          insert into public.customers (
            organization_id, name, phone, email, address, notes
          )
          values (
            v_session.organization_id, v_name, v_phone, v_email, v_address, v_notes
          );
        elsif v_item.action in ('use_existing', 'update') then
          v_existing_id := (v_item.match->>'existing_id')::uuid;

          select c.id
            into v_existing_id
            from public.customers c
           where c.id = v_existing_id
             and c.organization_id = v_session.organization_id
           for update;

          if not found then
            raise exception 'Item % : client cible absent de la même organisation', v_item.id;
          end if;

          if v_item.action = 'update' then
            update public.customers
               set name = v_name,
                   phone = coalesce(v_phone, phone),
                   email = coalesce(v_email, email),
                   address = coalesce(v_address, address),
                   notes = coalesce(v_notes, notes)
             where id = v_existing_id
               and organization_id = v_session.organization_id;
          end if;
        end if;

      else
        if v_item.action = 'create' then
          insert into public.suppliers (
            organization_id, name, phone, email, address, notes
          )
          values (
            v_session.organization_id, v_name, v_phone, v_email, v_address, v_notes
          );
        elsif v_item.action in ('use_existing', 'update') then
          v_existing_id := (v_item.match->>'existing_id')::uuid;

          select s.id
            into v_existing_id
            from public.suppliers s
           where s.id = v_existing_id
             and s.organization_id = v_session.organization_id
           for update;

          if not found then
            raise exception 'Item % : fournisseur cible absent de la même organisation', v_item.id;
          end if;

          if v_item.action = 'update' then
            update public.suppliers
               set name = v_name,
                   phone = coalesce(v_phone, phone),
                   email = coalesce(v_email, email),
                   address = coalesce(v_address, address),
                   notes = coalesce(v_notes, notes)
             where id = v_existing_id
               and organization_id = v_session.organization_id;
          end if;
        end if;
      end if;
    end if;

    update public.import_items
       set status = 'imported',
           error_message = null
     where id = v_item.id
       and v_item.action <> 'ignore';
  end loop;

  -- Les items ignored restent ignored. Toute autre ligne doit être imported.
  if exists (
    select 1
      from public.import_items i
     where i.session_id = v_session.id
       and i.organization_id = v_session.organization_id
       and i.action <> 'ignore'
       and i.status <> 'imported'
  ) then
    raise exception 'Le commit n''a pas marqué tous les items importables';
  end if;

  update public.import_sessions
     set state = 'completed'
   where id = v_session.id
     and state = 'importing'
  returning * into v_session;

  return v_session;
end;
$$;

revoke execute on function public.import_commit(uuid) from public, anon;
grant execute on function public.import_commit(uuid) to authenticated;

commit;
