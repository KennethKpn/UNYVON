-- ============================================================================
-- UNYVON — SMART DATA IMPORT PHASE 5 — Vérification DB réelle
--
-- À exécuter dans le SQL Editor du PROJET SUPABASE UNYVON uniquement.
--
-- Couverture :
--   1. Présence des RPC 0013/0014/0015 + SECURITY INVOKER.
--   2. EXECUTE : authenticated OUI, anon/PUBLIC NON.
--   3. RLS toujours active sur import_* et tables métier.
--   4. Commit réel create category + product dans une transaction.
--   5. Update réel : les champs absents d'un produit existant sont préservés.
--   6. Rollback réel : une erreur au milieu annule tout et laisse READY.
--   7. Cross-tenant réel : target UUID d'une autre organisation refusée.
--
-- IMPORTANT :
--   - Aucun secret.
--   - Aucun helper permanent.
--   - Aucune donnée n'est persistée : ROLLBACK final obligatoire.
--   - Si une assertion échoue, le bloc est annulé avant toute persistance.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Catalogue + surface RPC
-- ---------------------------------------------------------------------------
do $$
declare
  v_security_definer boolean;
  v_has_authenticated boolean;
  v_has_anon boolean;
  v_has_public boolean;
  v_count integer;
begin
  if to_regprocedure('public.materialize_import_document(uuid,jsonb,integer)') is null then
    raise exception 'ECHEC : RPC materialize_import_document absente';
  end if;

  if to_regprocedure('public.apply_import_matches(uuid,jsonb)') is null then
    raise exception 'ECHEC : RPC apply_import_matches absente';
  end if;

  if to_regprocedure('public.set_import_item_decision(uuid,public.import_item_action,uuid)') is null then
    raise exception 'ECHEC : RPC set_import_item_decision absente';
  end if;

  if to_regprocedure('public.finalize_import_review(uuid)') is null then
    raise exception 'ECHEC : RPC finalize_import_review absente';
  end if;

  if to_regprocedure('public.import_commit(uuid)') is null then
    raise exception 'ECHEC : RPC import_commit absente';
  end if;

  if to_regclass('public.import_sessions') is null
     or to_regclass('public.import_documents') is null
     or to_regclass('public.import_items') is null
     or to_regclass('public.categories') is null
     or to_regclass('public.products') is null
     or to_regclass('public.customers') is null
     or to_regclass('public.suppliers') is null
  then
    raise exception 'ECHEC : table import/métier manquante';
  end if;

  select count(*) into v_count
    from pg_class
   where oid in (
     'public.import_sessions'::regclass,
     'public.import_documents'::regclass,
     'public.import_items'::regclass,
     'public.categories'::regclass,
     'public.products'::regclass,
     'public.customers'::regclass,
     'public.suppliers'::regclass
   )
   and relrowsecurity;

  if v_count <> 7 then
    raise exception 'ECHEC : RLS non activée sur toutes les tables attendues (%/7)', v_count;
  end if;

  select prosecdef into v_security_definer
    from pg_proc
   where oid = 'public.import_commit(uuid)'::regprocedure;

  if v_security_definer then
    raise exception 'ECHEC : import_commit est SECURITY DEFINER';
  end if;

  select
    has_function_privilege('authenticated', 'public.import_commit(uuid)', 'EXECUTE'),
    has_function_privilege('anon', 'public.import_commit(uuid)', 'EXECUTE'),
    has_function_privilege('public', 'public.import_commit(uuid)', 'EXECUTE')
    into v_has_authenticated, v_has_anon, v_has_public;

  if not v_has_authenticated then
    raise exception 'ECHEC : authenticated ne possède pas EXECUTE sur import_commit';
  end if;

  if v_has_anon or v_has_public then
    raise exception 'ECHEC : anon/PUBLIC possède EXECUTE sur import_commit';
  end if;

  select prosecdef into v_security_definer
    from pg_proc
   where oid = 'public.materialize_import_document(uuid,jsonb,integer)'::regprocedure;
  if v_security_definer then
    raise exception 'ECHEC : materialize_import_document est SECURITY DEFINER';
  end if;

  select prosecdef into v_security_definer
    from pg_proc
   where oid = 'public.apply_import_matches(uuid,jsonb)'::regprocedure;
  if v_security_definer then
    raise exception 'ECHEC : apply_import_matches est SECURITY DEFINER';
  end if;

  select prosecdef into v_security_definer
    from pg_proc
   where oid = 'public.set_import_item_decision(uuid,public.import_item_action,uuid)'::regprocedure;
  if v_security_definer then
    raise exception 'ECHEC : set_import_item_decision est SECURITY DEFINER';
  end if;

  select prosecdef into v_security_definer
    from pg_proc
   where oid = 'public.finalize_import_review(uuid)'::regprocedure;
  if v_security_definer then
    raise exception 'ECHEC : finalize_import_review est SECURITY DEFINER';
  end if;

  raise notice 'OK 1/7 : RPC présentes, SECURITY INVOKER, EXECUTE restreint';
end $$;

-- Vérifie aussi les autres RPC : authenticated oui, anon/public non.
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.materialize_import_document(uuid,jsonb,integer)',
    'public.apply_import_matches(uuid,jsonb)',
    'public.set_import_item_decision(uuid,public.import_item_action,uuid)',
    'public.finalize_import_review(uuid)'
  ]
  loop
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'ECHEC : authenticated ne possède pas EXECUTE sur %', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('public', v_fn, 'EXECUTE')
    then
      raise exception 'ECHEC : anon/PUBLIC possède EXECUTE sur %', v_fn;
    end if;
  end loop;

  raise notice 'OK 2/7 : grants RPC conformes sur toutes les opérations Phase 5';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Fixtures temporaires
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner uuid;
  v_org_a uuid;
  v_org_b uuid;
  v_session uuid;
  v_session_rollback uuid;
  v_session_cross uuid;
  v_category_id uuid;
  v_product_id uuid;
  v_cross_product_id uuid;
  v_item_category uuid;
  v_item_product uuid;
  v_item_update uuid;
  v_item_rollback uuid;
  v_item_cross uuid;
  v_document_id uuid;
  v_session_state text;
  v_invalid_product_name text;
  v_token text := replace(gen_random_uuid()::text, '-', '');
  v_token2 text := replace(gen_random_uuid()::text, '-', '');
  v_before_cost numeric := 123.45;
  v_before_unit text := 'kg';
  v_before_threshold integer := 7;
  v_after_name text;
  v_after_sale numeric;
  v_after_cost numeric;
  v_after_unit text;
  v_after_threshold integer;
  v_before_count integer;
  v_after_count integer;
  v_error_seen boolean := false;
begin
  select user_id, organization_id
    into v_owner, v_org_a
    from public.organization_users
   where role = 'owner'
   order by created_at
   limit 1;

  if v_owner is null or v_org_a is null then
    raise notice 'SKIP : aucun owner/org existant pour le test runtime';
    return;
  end if;

  -- Organisation B de fixture, même owner : la différence de tenant suffit
  -- pour prouver la revalidation du target UUID.
  insert into public.organizations (
    name, sector, currency, created_by
  )
  values (
    'IMPORT_VERIFY_B_' || v_token,
    'verify',
    'FCFA',
    v_owner
  )
  returning id into v_org_b;

  -- -------------------------------------------------------------------------
  -- 2A. Commit nominal : catégorie + produit créés dans le même import.
  -- -------------------------------------------------------------------------
  insert into public.import_sessions (
    organization_id, created_by, state
  )
  values (
    v_org_a, v_owner, 'ready'
  )
  returning id into v_session;

  insert into public.import_documents (
    session_id, organization_id, original_name, source_kind, mime_type,
    size_bytes, storage_path, state, page_count, processed_at
  )
  values (
    v_session, v_org_a, 'verify.md', 'md', 'text/markdown',
    10,
    'organizations/' || v_org_a || '/imports/' || v_session
      || '/documents/' || gen_random_uuid() || '/verify.md',
    'extracted', 1, clock_timestamp()
  );

  select id into v_document_id
    from public.import_documents
   where session_id = v_session
   order by created_at desc
   limit 1;

  -- Création d'un vrai item catégorie.
  insert into public.import_items (
    session_id, document_id, organization_id, entity_type, source_page,
    fields, match, action, status
  )
  values (
    v_session, v_document_id, v_org_a, 'category', 1,
    jsonb_build_object(
      'name', jsonb_build_object(
        'raw', 'Boissons verify ' || v_token,
        'normalized', 'Boissons verify ' || v_token,
        'confidence', 'high',
        'warning', null,
        'page', 1
      )
    ),
    null, 'create', 'validated'
  )
  returning id into v_item_category;

  insert into public.import_items (
    session_id, document_id, organization_id, entity_type, source_page,
    fields, match, action, status
  )
  values (
    v_session, v_document_id,
    v_org_a, 'product', 1,
    jsonb_build_object(
      'name', jsonb_build_object(
        'raw', 'Produit verify ' || v_token,
        'normalized', 'Produit verify ' || v_token,
        'confidence', 'high',
        'warning', null,
        'page', 1
      ),
      'unit', jsonb_build_object(
        'raw', 'piece',
        'normalized', 'piece',
        'confidence', 'high',
        'warning', null,
        'page', 1
      ),
      'sale_price', jsonb_build_object(
        'raw', '2500',
        'normalized', 2500,
        'confidence', 'high',
        'warning', null,
        'page', 1
      ),
      'category', jsonb_build_object(
        'raw', 'Boissons verify ' || v_token,
        'normalized', 'Boissons verify ' || v_token,
        'confidence', 'high',
        'warning', null,
        'page', 1
      )
    ),
    null, 'create', 'validated'
  )
  returning id into v_item_product;

  -- Les deux items utilisent le même document de fixture.

  -- Auth runtime : owner A.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_owner::text,
    'role', 'authenticated'
  )::text, true);
  set local role authenticated;

  begin
    perform public.import_commit(v_session);
  exception
    when others then
      raise exception 'ECHEC : commit nominal rejeté — %', sqlerrm;
  end;

  reset role;

  select state::text into v_session_state
    from public.import_sessions
   where id = v_session;

  if v_session_state <> 'completed' then
    raise exception 'ECHEC : session nominale non completed (état=%)', v_session_state;
  end if;

  select count(*) into v_after_count
    from public.categories
   where organization_id = v_org_a
     and name = 'Boissons verify ' || v_token;
  if v_after_count <> 1 then
    raise exception 'ECHEC : catégorie nominale absente';
  end if;

  select count(*) into v_after_count
    from public.products
   where organization_id = v_org_a
     and name = 'Produit verify ' || v_token
     and sale_price = 2500;
  if v_after_count <> 1 then
    raise exception 'ECHEC : produit nominal absent';
  end if;

  raise notice 'OK 3/7 : commit nominal catégorie + produit';
  
  -- -------------------------------------------------------------------------
  -- 3. Update partiel : conservation des champs absents.
  -- -------------------------------------------------------------------------
  insert into public.products (
    organization_id, name, unit, cost_price, sale_price, min_stock_threshold
  )
  values (
    v_org_a, 'Produit update verify ' || v_token,
    v_before_unit, v_before_cost, 1000, v_before_threshold
  )
  returning id into v_product_id;

  insert into public.import_sessions (
    organization_id, created_by, state
  )
  values (v_org_a, v_owner, 'ready')
  returning id into v_session_rollback;

  insert into public.import_documents (
    session_id, organization_id, original_name, source_kind, mime_type,
    size_bytes, storage_path, state, page_count, processed_at
  )
  values (
    v_session_rollback, v_org_a, 'verify-update.md', 'md', 'text/markdown',
    10,
    'organizations/' || v_org_a || '/imports/' || v_session_rollback
      || '/documents/' || gen_random_uuid() || '/verify-update.md',
    'extracted', 1, clock_timestamp()
  );

  select id into v_document_id
    from public.import_documents
   where session_id = v_session_rollback
   order by created_at desc
   limit 1;

  insert into public.import_items (
    session_id, document_id, organization_id, entity_type, source_page,
    fields, match, action, status
  )
  values (
    v_session_rollback, v_document_id, v_org_a, 'product', 1,
    jsonb_build_object(
      'name', jsonb_build_object(
        'raw', 'Produit update verify ' || v_token,
        'normalized', 'Produit update verify ' || v_token,
        'confidence', 'high',
        'warning', null,
        'page', 1
      ),
      'sale_price', jsonb_build_object(
        'raw', '1200',
        'normalized', 1200,
        'confidence', 'high',
        'warning', null,
        'page', 1
      )
    ),
    jsonb_build_object(
      'existing_id', v_product_id,
      'existing_name', 'Produit update verify ' || v_token,
      'score', 1,
      'reason', 'verification'
    ),
    'update',
    'validated'
  )
  returning id into v_item_update;

  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_owner::text,
    'role', 'authenticated'
  )::text, true);
  set local role authenticated;
  perform public.import_commit(v_session_rollback);
  reset role;

  select name, sale_price, cost_price, unit, min_stock_threshold
    into v_after_name, v_after_sale, v_after_cost, v_after_unit, v_after_threshold
    from public.products
   where id = v_product_id;

  if v_after_name <> 'Produit update verify ' || v_token
     or v_after_sale <> 1200
     or v_after_cost <> v_before_cost
     or v_after_unit <> v_before_unit
     or v_after_threshold <> v_before_threshold
  then
    raise exception
      'ECHEC : update partiel a écrasé un champ absent (name %, sale %, cost %, unit %, threshold %)',
      v_after_name, v_after_sale, v_after_cost, v_after_unit, v_after_threshold;
  end if;

  raise notice 'OK 4/7 : update partiel préserve les champs absents';

  -- -------------------------------------------------------------------------
  -- 4. Rollback réel : catégorie absente -> aucun écrit durable, session READY.
  -- -------------------------------------------------------------------------
  insert into public.import_sessions (
    organization_id, created_by, state
  )
  values (v_org_a, v_owner, 'ready')
  returning id into v_session_rollback;

  insert into public.import_documents (
    session_id, organization_id, original_name, source_kind, mime_type,
    size_bytes, storage_path, state, page_count, processed_at
  )
  values (
    v_session_rollback, v_org_a, 'verify-rollback.md', 'md', 'text/markdown',
    10,
    'organizations/' || v_org_a || '/imports/' || v_session_rollback
      || '/documents/' || gen_random_uuid() || '/verify-rollback.md',
    'extracted', 1, clock_timestamp()
  );

  select id into v_category_id
    from public.import_documents
   where session_id = v_session_rollback
   order by created_at desc
   limit 1;

  v_invalid_product_name := 'ROLLBACK_PRODUCT_' || v_token2;

  insert into public.import_items (
    session_id, document_id, organization_id, entity_type, source_page,
    fields, match, action, status
  )
  values (
    v_session_rollback, v_category_id, v_org_a, 'product', 1,
    jsonb_build_object(
      'name', jsonb_build_object(
        'raw', v_invalid_product_name,
        'normalized', v_invalid_product_name,
        'confidence', 'high',
        'warning', null,
        'page', 1
      ),
      'sale_price', jsonb_build_object(
        'raw', '999',
        'normalized', 999,
        'confidence', 'high',
        'warning', null,
        'page', 1
      ),
      'category', jsonb_build_object(
        'raw', 'CATEGORY_THAT_DOES_NOT_EXIST_' || v_token2,
        'normalized', 'CATEGORY_THAT_DOES_NOT_EXIST_' || v_token2,
        'confidence', 'high',
        'warning', null,
        'page', 1
      )
    ),
    null, 'create', 'validated'
  )
  returning id into v_item_rollback;

  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_owner::text,
    'role', 'authenticated'
  )::text, true);
  set local role authenticated;

  begin
    perform public.import_commit(v_session_rollback);
    raise exception 'TEST_EXPECTED_FAILURE_WAS_NOT_RAISED';
  exception
    when others then
      if sqlerrm like 'TEST_EXPECTED_FAILURE_WAS_NOT_RAISED' then
        raise;
      end if;
      v_error_seen := true;
  end;

  reset role;

  if not v_error_seen then
    raise exception 'ECHEC : le commit invalide n''a pas échoué';
  end if;

  select state::text into v_session_state
    from public.import_sessions
   where id = v_session_rollback;

  if v_session_state <> 'ready' then
    raise exception 'ECHEC rollback : session non restaurée à ready (état=%)', v_session_state;
  end if;

  select count(*) into v_after_count
    from public.products
   where organization_id = v_org_a
     and name = v_invalid_product_name;

  if v_after_count <> 0 then
    raise exception 'ECHEC rollback : produit invalide persistant';
  end if;

  raise notice 'OK 5/7 : rollback transactionnel laisse READY et zéro produit invalide';

  -- -------------------------------------------------------------------------
  -- 5. Cross-tenant : target product B doit être refusé depuis org A.
  -- -------------------------------------------------------------------------
  insert into public.products (
    organization_id, name, unit, cost_price, sale_price, min_stock_threshold
  )
  values (
    v_org_b, 'TARGET_CROSS_ORG_' || v_token2,
    'piece', 10, 20, 1
  )
  returning id into v_cross_product_id;

  insert into public.import_sessions (
    organization_id, created_by, state
  )
  values (v_org_a, v_owner, 'ready')
  returning id into v_session_cross;

  insert into public.import_documents (
    session_id, organization_id, original_name, source_kind, mime_type,
    size_bytes, storage_path, state, page_count, processed_at
  )
  values (
    v_session_cross, v_org_a, 'verify-cross.md', 'md', 'text/markdown',
    10,
    'organizations/' || v_org_a || '/imports/' || v_session_cross
      || '/documents/' || gen_random_uuid() || '/verify-cross.md',
    'extracted', 1, clock_timestamp()
  );

  select id into v_document_id
    from public.import_documents
   where session_id = v_session_cross
   order by created_at desc
   limit 1;

  insert into public.import_items (
    session_id, document_id, organization_id, entity_type, source_page,
    fields, match, action, status
  )
  values (
    v_session_cross, v_document_id, v_org_a, 'product', 1,
    jsonb_build_object(
      'name', jsonb_build_object(
        'raw', 'Cross tenant verify',
        'normalized', 'Cross tenant verify',
        'confidence', 'high',
        'warning', null,
        'page', 1
      ),
      'sale_price', jsonb_build_object(
        'raw', '300',
        'normalized', 300,
        'confidence', 'high',
        'warning', null,
        'page', 1
      )
    ),
    jsonb_build_object(
      'existing_id', v_cross_product_id,
      'existing_name', 'forged cross-tenant target',
      'score', 1,
      'reason', 'hostile test'
    ),
    'update',
    'validated'
  )
  returning id into v_item_cross;

  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_owner::text,
    'role', 'authenticated'
  )::text, true);
  set local role authenticated;

  v_error_seen := false;
  begin
    perform public.import_commit(v_session_cross);
    raise exception 'TEST_EXPECTED_CROSS_TENANT_FAILURE_WAS_NOT_RAISED';
  exception
    when others then
      if sqlerrm like 'TEST_EXPECTED_CROSS_TENANT_FAILURE_WAS_NOT_RAISED' then
        raise;
      end if;
      v_error_seen := true;
  end;

  reset role;

  if not v_error_seen then
    raise exception 'ECHEC : target cross-tenant non refusée';
  end if;

  select count(*) into v_after_count
    from public.products
   where id = v_cross_product_id
     and sale_price = 20;

  if v_after_count <> 1 then
    raise exception 'ECHEC : produit B a été modifié par le tenant A';
  end if;

  raise notice 'OK 6/7 : target UUID cross-tenant refusée et cible intacte';

  raise notice 'OK 7/7 : tous les contrôles runtime Phase 5 sont passés';

exception
  when others then
    reset role;
    raise;
end $$;

-- ---------------------------------------------------------------------------
-- 3. ROLLBACK global : fixtures + écritures de test supprimés.
-- ---------------------------------------------------------------------------
rollback;

do $$
begin
  raise notice '=== FIN : aucun objet/donnée de test ne doit subsister ===';
end $$;
