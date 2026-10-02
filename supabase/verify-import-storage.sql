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
--            'uploaded', suppression de la row applicative),
--            systematiquement annule par ROLLBACK.
-- HORS PERIMETRE SQL — suppression d'un objet Storage. Supabase interdit le
-- DELETE direct sur storage.objects ("Direct deletion from storage tables is
-- not allowed. Use the Storage API instead."). deleteImportDocument passe donc
-- par la Storage API (.remove([...])) : l'ordre row -> objet et l'absence
-- d'orphelin sont verifies par test-storage-delete-runtime.js, en contexte
-- `authenticated` (service_role contournerait la RLS et ne prouverait rien).
-- Chaque ecart leve une exception => script en echec = migration non conforme.
--
-- REVERSIBILITE : le helper test_set_auth est cree DANS la transaction
-- ci-dessous, annulee par le ROLLBACK final : il ne survit jamais a une
-- execution reussie -- et n'est pas non plus laisse par une execution en
-- echec (la transaction est alors avortee). Un cleanup explicite + une
-- assertion post-rollback ferment le cas d'un run anterieur deja pollue.
-- Raison de securite : public.test_set_auth est SECURITY DEFINER ; laisse
-- installe, il est appelable par PUBLIC (defaut Postgres sur le schema
-- public) et permet d'usurper n'importe quel `sub` => contournement de RLS.
-- ============================================================================

begin;

-- Helper : equivalent auth.uid() pour les tests (memes definitions que
-- verify-rls.sql / verify-import.sql, idempotent). Cree dans la
-- transaction => jamais persiste.
create or replace function public.test_set_auth(uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- true = SET LOCAL : le contexte d'impersonation n'existe que dans la
  -- transaction et est annule par le ROLLBACK (jamais residues en session).
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
  v_cmd text;
  v_roles name[];
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

-- 1.5 DELETE : SANS exigence d'existence de row. deleteImportDocument
  --     supprime la row PostgreSQL PUIS appelle la Storage API
  --     (.remove([...])) : au moment ou l'objet est supprime, la row
  --     n'existe deja plus. Une exigence de row ici rendrait la suppression
  --     de l'objet impossible => orphelin garanti.
  --     Seul controle structurel possible en SQL : le DELETE direct sur
  --     storage.objects est interdit par Supabase (voir en-tete).
  select qual, cmd, roles into v_qual, v_cmd, v_roles
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname = 'imports_delete_owner_manager';

  if v_qual is null then
    raise exception 'ECHEC : policy imports_delete_owner_manager absente de storage.objects';
  end if;
  if v_cmd <> 'DELETE' then
    raise exception 'ECHEC : imports_delete_owner_manager est une policy % (attendu DELETE)', v_cmd;
  end if;
  if not (coalesce(v_roles, '{}'::name[]) @> ARRAY['authenticated'::name]) then
    raise exception 'ECHEC : imports_delete_owner_manager ne s''applique pas au role authenticated (roles: %)', v_roles;
  end if;
  if position('import_documents' in v_qual) > 0 then
    raise exception 'ECHEC : imports_delete_owner_manager ne doit pas exiger la row import_documents (qual: %)', v_qual;
  end if;
  if position('d.state' in v_qual) > 0 then
    raise exception 'ECHEC : imports_delete_owner_manager ne doit pas dependre de l''etat du document (qual: %)', v_qual;
  end if;
  raise notice 'OK : imports_delete_owner_manager FOR DELETE, role authenticated, sans dependance a la row ni a l''etat';

  raise notice '=== PARTIE 1 OK — policies storage import conformes ===';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Aller-retour ecriture impersonne owner (annule par le ROLLBACK final)
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
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('imports', v_path, v_user::text, '{"mimetype":"application/pdf"}'::jsonb);
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
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('imports', v_reupload_path, v_user::text, '{"mimetype":"application/pdf"}'::jsonb);
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

  -- 2.7 Suppression de la row import_documents — seule suppression que le SQL
  --     peut exercer (table applicative, RLS active).
  --     L'ordre row -> objet de deleteImportDocument n'est PAS verifiable ici :
  --     Supabase interdit le DELETE direct sur storage.objects ("Direct
  --     deletion from storage tables is not allowed"). L'objet est supprime via
  --     la Storage API (.remove([...])) ; ce comportement, ainsi que l'absence
  --     d'orphelin, est verifie par test-storage-delete-runtime.js (contexte
  --     authenticated, pas service_role).
  --     Le ROLLBACK final annule de toute facon l'objet insere en 2.2.
  perform public.test_set_auth(v_user);
  set local role authenticated;
  delete from public.import_documents where id = v_did;
  get diagnostics v_count = row_count;
  reset role;
  perform public.test_set_auth(null);

  if v_count <> 1 then
    raise exception 'ECHEC : suppression de la row import_documents refusee par la RLS (%)', v_count;
  end if;
  raise notice 'OK : row import_documents supprimable par un owner (objet : via Storage API — cf. test-storage-delete-runtime.js)';

  raise notice '=== PARTIE 2 OK — integrite Storage import conforme ===';
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- 3. Reversibilite : aucun objet auxiliaire ne doit subsister
--
-- Le ROLLBACK ci-dessus a deja supprime test_set_auth. Ce bloc couvre le cas
-- d'un run anterieur (avant reversibilite) qui l'aurait laisse installe :
-- `drop ... if exists` est donc volontairement inconditionnel, et l'assertion
-- qui suit prouve l'absence effective plutot que de la supposer.
-- ---------------------------------------------------------------------------
drop function if exists public.test_set_auth(uuid);

do $$
begin
  if to_regprocedure('public.test_set_auth(uuid)') is not null then
    raise exception
      'ECHEC : le helper public.test_set_auth(uuid) a survecu a la verification';
  end if;
  raise notice 'OK : aucun objet auxiliaire test_set_auth ne subsiste';
end $$;
