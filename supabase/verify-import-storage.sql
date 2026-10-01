-- ============================================================================
-- UNYVON — Verification de l'integrite Storage Smart Data Import
--
-- A executer dans le SQL Editor Supabase APRES avoir applique
-- supabase/migrations/0011_import.sql puis
-- supabase/migrations/0012_import_storage_integrity.sql.
--
-- Partie 1 : controles de catalogue (policies storage imports_*) —
--            100 % deterministe, aucune donnee necessaire.
-- Partie 2 : aller-retour ecriture impersonne owner sur storage.objects
--            (upload autorise pendant 'uploading', contenu immuable des
--            'uploaded', suppression row PUIS objet validee),
--            systematiquement annule par ROLLBACK.
-- Chaque ecart leve une exception => script en echec = migration non conforme.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- REVERSIBILITY : ce script ne doit laisser aucune mutation métier ni helper
-- de test persistant. Toute la vérification est exécutée dans une transaction
-- unique ; le ROLLBACK final annule aussi la création du helper temporaire.
-- ---------------------------------------------------------------------------

begin;

-- Helper : equivalent auth.uid() pour les tests (memes definitions que
-- verify-rls.sql / verify-import.sql, idempotent).
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
-- 1. Catalogue des policies Storage
-- ---------------------------------------------------------------------------
do $$
declare
  v int;
begin
  -- 1.1 Exactement 4 policies imports_* sur storage.objects
  select count(*) into v from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'imports\_%';
  if v <> 4 then
    raise exception 'ECHEC : % policies Storage imports (attendu 4)', v;
  end if;
end $$;

-- 1.2 Seules politiques d'ecriture pour authenticated
--     (pas de policy permissive tierce qui contournerait
--     l'etat 'uploading')
do $$
declare
  v int;
begin
  select count(*) into v
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and cmd in ('INSERT', 'UPDATE')
    and roles @> ARRAY['authenticated'::name];

  if v <> 2 then
    raise exception
      'ECHEC : % policies insert/update pour authenticated (attendu 2 : imports_insert/update)',
      v;
  end if;

  raise notice 'OK : 4 policies imports_* et 2 seules ecritures authenticated';
end $$;

do $$
declare
  v int;
  v_qual text;
  v_check text;
begin
  -- 1.3 INSERT : existence de row + etat 'uploading'
  select with_check into v_check from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname = 'imports_insert_owner_manager';
  if v_check is null
     or position('import_documents' in v_check) = 0
     or position('uploading' in v_check) = 0 then
    raise exception 'ECHEC : imports_insert_owner_manager sans garde etat uploading (with_check: %)', v_check;
  end if;
  raise notice 'OK : imports_insert_owner_manager exige import_documents etat uploading';

  -- 1.4 UPDATE : existence de row + etat 'uploading'
  select qual into v_qual from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname = 'imports_update_owner_manager';
  if v_qual is null
     or position('import_documents' in v_qual) = 0
     or position('uploading' in v_qual) = 0 then
    raise exception 'ECHEC : imports_update_owner_manager sans garde etat uploading (qual: %)', v_qual;
  end if;
  raise notice 'OK : imports_update_owner_manager exige import_documents etat uploading';

  -- 1.5 DELETE : SANS exigence d'existence de row (deleteImportDocument
  --     supprime la row PostgreSQL puis l'objet ; une exigence de row
  --     rendrait la suppression de l'impossible => objet orphelin).
  select qual into v_qual from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname = 'imports_delete_owner_manager';
  if v_qual is null or position('import_documents' in v_qual) > 0 then
    raise exception 'ECHEC : imports_delete_owner_manager ne doit pas exiger la row import_documents (qual: %)', v_qual;
  end if;
  raise notice 'OK : imports_delete_owner_manager sans dependance a la row (suppression row puis objet possible)';

  raise notice '=== PARTIE 1 OK — policies storage import conformes ===';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Aller-retour ecriture impersonne owner (annule par ROLLBACK)
-- ---------------------------------------------------------------------------
do $$
declare
  v_user   uuid;
  v_org    uuid;
  v_sid    uuid;
  v_did    uuid := gen_random_uuid();
  v_path   text;
  v_reupload_path text;
  v_count  int;
begin
  select user_id, organization_id into v_user, v_org
    from public.organization_users
   where role = 'owner'
   order by created_at
   limit 1;

  if v_user is null then
    raise notice 'Aucun owner trouve : creez un compte via signup/onboarding puis relancez.';
    return;
  end if;

  perform public.test_set_auth(v_user);
  set local role authenticated;

  -- 2.1 Session + document (etat 'uploading' par defaut), chemin conforme
  insert into public.import_sessions (organization_id, created_by)
  values (v_org, v_user)
  returning id into v_sid;

  v_path := 'organizations/' || v_org || '/imports/' || v_sid
         || '/documents/' || v_did || '/stock-test.pdf';

  insert into public.import_documents (
    id, session_id, organization_id, original_name, source_kind,
    mime_type, size_bytes, storage_path
  ) values (
    v_did, v_sid, v_org, 'stock-test.pdf', 'pdf',
    'application/pdf', 1024, v_path
  );

  -- 2.2 INSERT objet autorise pendant 'uploading'
  begin
    insert into storage.objects (bucket_id, name, owner, metadata)
    values ('imports', v_path, v_user, '{"mimetype":"application/pdf"}'::jsonb);
  exception when others then
    reset role;
    perform public.test_set_auth(null);
    raise exception 'ECHEC : insert objet refuse alors que le document est en uploading (%)', sqlerrm;
  end;

  -- 2.3 UPDATE objet autorise pendant 'uploading' (relance d'upload)
  update storage.objects
     set metadata = '{"mimetype":"application/pdf","reupload":true}'::jsonb
   where bucket_id = 'imports' and name = v_path;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    reset role;
    perform public.test_set_auth(null);
    raise exception 'ECHEC : update objet refuse alors que le document est en uploading (% ligne)', v_count;
  end if;

  -- 2.4 Le document passe a 'uploaded' => contenu immuable
  update public.import_documents
     set state = 'uploaded'
   where id = v_did;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    reset role;
    perform public.test_set_auth(null);
    raise exception 'ECHEC : transition uploading -> uploaded refusee par RLS (%)', v_count;
  end if;

  -- 2.5 Re-upload sur NOUVEAU chemin REFUSE apres 'uploaded'
  --     (nouveau chemin : la seule cause possible du refus est la policy RLS,
  --     pas une contrainte d'unicite)
  v_reupload_path := 'organizations/' || v_org || '/imports/' || v_sid
                   || '/documents/' || v_did || '/stock-test-reupload.pdf';
  begin
    insert into storage.objects (bucket_id, name, owner, metadata)
    values ('imports', v_reupload_path, v_user, '{"mimetype":"application/pdf"}'::jsonb);
    reset role;
    perform public.test_set_auth(null);
    raise exception 'ECHEC : re-upload sur nouveau chemin accepté après uploaded';
  exception when others then
    if sqlerrm like 'ECHEC%' then
      raise;
    end if;
    if sqlstate = '42501' then
      reset role;
      perform public.test_set_auth(null);
      raise notice 'OK : nouveau chemin bloqué par la policy après uploaded (%)', sqlerrm;
    else
      reset role;
      perform public.test_set_auth(null);
      raise exception 'ECHEC : erreur inattendue re-upload (%) sqlstate %', sqlerrm, sqlstate;
    end if;
  end;

  -- 2.6 UPDATE objet REFUSE apres 'uploaded' (0 ligne : policy USING fausse)
  perform public.test_set_auth(v_user);
  set local role authenticated;
  update storage.objects
     set metadata = '{"mimetype":"application/pdf","tampered":true}'::jsonb
   where bucket_id = 'imports' and name = v_path;
  get diagnostics v_count = row_count;
  reset role;
  perform public.test_set_auth(null);
  if v_count <> 0 then
    raise exception 'ECHEC : objet modifiable apres uploaded (% ligne modifiee)', v_count;
  end if;
  raise notice 'OK : objet immuable apres uploaded (update bloque)';

  -- 2.7 Ordre de suppression de deleteImportDocument : row PUIS objet
  perform public.test_set_auth(v_user);
  set local role authenticated;
  delete from public.import_documents where id = v_did;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    reset role;
    perform public.test_set_auth(null);
    raise exception 'ECHEC : suppression de la row import_documents refusee (%)', v_count;
  end if;

  begin
    delete from storage.objects where bucket_id = 'imports' and name = v_path;
    get diagnostics v_count = row_count;
  exception when others then
    reset role;
    perform public.test_set_auth(null);
    raise exception 'ECHEC : objet non supprimable apres la row (policy delete depend de la row ?) %', sqlerrm;
  end;
  reset role;
  perform public.test_set_auth(null);

  if v_count <> 1 then
    raise exception 'ECHEC : objet Storage non supprime apres la row (% ligne)', v_count;
  end if;
  raise notice 'OK : suppression row puis objet (aucun orphelin)';

  raise notice '=== PARTIE 2 OK — integrite Storage import conforme ===';
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
