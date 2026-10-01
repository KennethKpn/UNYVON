-- ============================================================================
-- UNYVON — Vérification du schéma Smart Data Import
--
-- À exécuter dans le SQL Editor Supabase APRÈS avoir appliqué
-- supabase/migrations/0011_import.sql.
--
-- Partie 1 : contrôles de catalogue (enums, tables, RLS, policies, bucket,
--            helpers, FK) — 100% déterministe, aucune donnée nécessaire.
-- Partie 2 : aller-retour écriture impersonné owner/seller, systématiquement
--            annulé par ROLLBACK (aucune donnée persistée).
-- Chaque écart lève une exception → script en échec = migration non conforme.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- REVERSIBILITY : ce script ne doit laisser aucune mutation métier ni helper
-- de test persistant. Toute la vérification est exécutée dans une transaction
-- unique ; le ROLLBACK final annule aussi la création du helper temporaire.
-- ---------------------------------------------------------------------------

begin;

-- Helper : équivalent auth.uid() pour les tests (même définition que
-- verify-rls.sql, idempotente).
create or replace function public.test_set_auth(uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid::text,
    'role', 'authenticated'
  )::text, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Catalogue
-- ---------------------------------------------------------------------------
do $$
declare
  v int;
  v_bool boolean;
begin
  -- 1.1 Tables
  if to_regclass('public.import_sessions') is null then
    raise exception 'ECHEC : table import_sessions absente — 0011_import.sql non appliquée';
  end if;
  if to_regclass('public.import_documents') is null then
    raise exception 'ECHEC : table import_documents absente — 0011_import.sql non appliquée';
  end if;
  if to_regclass('public.import_items') is null then
    raise exception 'ECHEC : table import_items absente — 0011_import.sql non appliquée';
  end if;
  raise notice 'OK : tables import_sessions / import_documents / import_items présentes';

  -- 1.2 RLS activé sur les 3 tables
  select relrowsecurity into v_bool from pg_class where oid = to_regclass('public.import_sessions');
  if not v_bool then raise exception 'ECHEC : RLS non activé sur import_sessions'; end if;
  select relrowsecurity into v_bool from pg_class where oid = to_regclass('public.import_documents');
  if not v_bool then raise exception 'ECHEC : RLS non activé sur import_documents'; end if;
  select relrowsecurity into v_bool from pg_class where oid = to_regclass('public.import_items');
  if not v_bool then raise exception 'ECHEC : RLS non activé sur import_items'; end if;
  raise notice 'OK : RLS activé sur les 3 tables';

  -- 1.3 4 policies (select/insert/update/delete) par table
  select count(*) into v from pg_policies where schemaname='public' and tablename='import_sessions';
  if v <> 4 then raise exception 'ECHEC : import_sessions a % policies (attendu 4)', v; end if;
  select count(*) into v from pg_policies where schemaname='public' and tablename='import_documents';
  if v <> 4 then raise exception 'ECHEC : import_documents a % policies (attendu 4)', v; end if;
  select count(*) into v from pg_policies where schemaname='public' and tablename='import_items';
  if v <> 4 then raise exception 'ECHEC : import_items a % policies (attendu 4)', v; end if;
  raise notice 'OK : 4 policies RLS par table import (12 au total)';

  -- 1.4 Enums (nombre de valeurs attendu)
  select count(*) into v from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'import_session_state';
  if v <> 8 then raise exception 'ECHEC : import_session_state a % valeurs (attendu 8)', v; end if;

  select count(*) into v from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'import_document_state';
  if v <> 7 then raise exception 'ECHEC : import_document_state a % valeurs (attendu 7)', v; end if;

  select count(*) into v from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'import_entity_type';
  if v <> 4 then raise exception 'ECHEC : import_entity_type a % valeurs (attendu 4)', v; end if;

  select count(*) into v from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'import_item_action';
  if v <> 4 then raise exception 'ECHEC : import_item_action a % valeurs (attendu 4)', v; end if;

  select count(*) into v from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'import_item_status';
  if v <> 5 then raise exception 'ECHEC : import_item_status a % valeurs (attendu 5)', v; end if;

  raise notice 'OK : 5 enums import avec le bon nombre de valeurs';

  -- 1.5 Contraintes d'intégrité composite
  select count(*) into v from information_schema.table_constraints
   where table_schema='public' and table_name='import_items'
     and constraint_type='FOREIGN KEY'
     and constraint_name in ('import_items_session_org_fkey', 'import_items_document_session_fkey');
  if v <> 2 then raise exception 'ECHEC : FK composites import_items absentes (%/2)', v; end if;

  select count(*) into v from information_schema.table_constraints
   where table_schema='public' and table_name='import_documents'
     and constraint_type='FOREIGN KEY'
     and constraint_name = 'import_documents_session_org_fkey';
  if v <> 1 then raise exception 'ECHEC : FK composite import_documents absente'; end if;
  raise notice 'OK : FK composites session/document/org présentes';

  -- 1.6 Bucket Storage privé
  select count(*) into v from storage.buckets
   where id = 'imports' and public = false and file_size_limit = 26214400;
  if v <> 1 then raise exception 'ECHEC : bucket imports absent ou mal configuré (privé, 25 Mo)'; end if;
  raise notice 'OK : bucket imports (privé, limite 25 Mo)';

  -- 1.7 4 policies Storage sur le bucket imports
  select count(*) into v from pg_policies
   where schemaname='storage' and tablename='objects'
     and policyname like 'imports\_%';
  if v <> 4 then raise exception 'ECHEC : % policies Storage imports (attendu 4)', v; end if;
  raise notice 'OK : 4 policies Storage (insert/update/select/delete)';

  -- 1.8 Helpers de chemin
  if to_regprocedure('public.storage_import_org_id(text)') is null
     or to_regprocedure('public.storage_import_session_id(text)') is null
     or to_regprocedure('public.storage_import_document_id(text)') is null then
    raise exception 'ECHEC : helpers storage_import_* manquants';
  end if;
  raise notice 'OK : helpers storage_import_org_id / session_id / document_id';

  raise notice '=== PARTIE 1 OK — catalogue import conforme ===';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Aller-retour écriture impersonné (annulé par ROLLBACK)
-- ---------------------------------------------------------------------------
do $$
declare
  v_user  uuid;
  v_org   uuid;
  v_seller uuid;
  v_sid   uuid;
  v_count int;
begin
  select user_id, organization_id into v_user, v_org
    from public.organization_users
   where role = 'owner'
   order by created_at
   limit 1;

  if v_user is null then
    raise notice 'Aucun owner trouvé : créez un compte via signup/onboarding puis relancez.';
    return;
  end if;

  select user_id into v_seller
    from public.organization_users
   where organization_id = v_org and role in ('seller', 'stockkeeper')
   limit 1;

  -- 2.1 Le owner crée une session + un document (chemin conforme)
  perform public.test_set_auth(v_user);
  set local role authenticated;

  insert into public.import_sessions (organization_id, created_by)
  values (v_org, v_user)
  returning id into v_sid;

  insert into public.import_documents (
    session_id, organization_id, original_name, source_kind,
    mime_type, size_bytes, storage_path
  ) values (
    v_sid, v_org, 'stock-test.pdf', 'pdf',
    'application/pdf', 1024,
    'organizations/' || v_org || '/imports/' || v_sid
      || '/documents/00000000-0000-0000-0000-000000000000/stock-test.pdf'
  );

  select count(*) into v_count
    from public.import_documents where session_id = v_sid;

  reset role;
  perform public.test_set_auth(null);

  if v_count <> 1 then
    raise exception 'ECHEC : le owner ne lit pas son document d''import (% ligne)', v_count;
  end if;
  raise notice 'OK : owner crée session + document d''import (1 ligne)';

  -- 2.2 Un seller/stockkeeper est REFUSÉ (RLS owner/manager)
  if v_seller is not null then
    perform public.test_set_auth(v_seller);
    begin
      set local role authenticated;
      insert into public.import_sessions (organization_id, created_by)
      values (v_org, v_seller);
      -- Si on arrive ici, la RLS a laissé passer → échec du test
      raise exception 'ECHEC : seller/stockkeeper a pu créer une session d''import';
    exception
      when others then
        reset role;
        perform public.test_set_auth(null);
        if sqlerrm like 'ECHEC%' then
          raise;
        end if;
        raise notice 'OK : seller/stockkeeper bloqué par la RLS (%)', sqlerrm;
    end;
  else
    raise notice 'Aucun seller/stockkeeper dans l''org : test négatif ignoré.';
  end if;

  raise notice '=== PARTIE 2 OK — RLS import conforme ===';
end $$;

rollback;

-- Contrôle post-rollback : le helper temporaire ne doit pas avoir survécu.
do $$
begin
  if to_regprocedure('public.test_set_auth(uuid)') is null then
    raise notice 'OK : le helper public.test_set_auth(uuid) n''a pas survécu au ROLLBACK';
  else
    raise exception 'ECHEC DE REVERSIBILITE : public.test_set_auth(uuid) existe encore après ROLLBACK';
  end if;
end $$;
