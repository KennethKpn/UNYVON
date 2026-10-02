-- ============================================================================
-- UNYVON — Smart Data Import : intégrité Storage (revue PR #1)
--
-- 1. imports_insert_owner_manager / imports_update_owner_manager
--    0011 exigeait uniquement l'existence de la row import_documents, QUEL
--    QUE SON ÉTAT : un document déjà 'uploaded' (ou plus loin dans le
--    pipeline) pouvait être écrasé → contenu modifiable après upload.
--    Correction : l'objet ne peut être créé/modifié que tant que la row est
--    en état 'uploading'.
--
-- 2. Fenêtre d'écriture (contrat d'immuabilité) :
--      - state = 'uploading'  → insert + update de l'objet AUTORISÉS
--        (upload initial, relance d'un upload échoué via failed → uploading) ;
--      - state ∈ {uploaded, parsing, parsed, extracting, extracted, failed}
--        → insert et update REFUSÉS : le contenu devient immuable dès
--        'uploaded' ; toute réécriture impose un retour à 'uploading'
--        (graphe de transitions, 0011/schemas.ts) ou une suppression
--        deleteImportDocument (row + objet).
--
-- 3. imports_delete_owner_manager reste SANS exigence d'existence de row :
--    deleteImportDocument supprime la row PostgreSQL PUIS l'objet Storage
--    (aucune transaction transversale possible entre les deux). Exiger la
--    row ici rendrait la suppression de l'objet impossible → orphelin garanti.
--
-- 4. Aucun ajout de policy : drop + create sur les mêmes noms (toujours
--    4 policies imports_* sur storage.objects, comme attendu par
--    supabase/verify-import.sql § 1.7).
--
-- Vérifier après application : supabase/verify-import-storage.sql
-- ============================================================================

begin;

drop policy "imports_insert_owner_manager" on storage.objects;

create policy "imports_insert_owner_manager"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'imports'
    and public.storage_import_org_id(name) is not null
    and public.is_org_member(public.storage_import_org_id(name))
    and public.current_org_role(public.storage_import_org_id(name)) in ('owner', 'manager')
    and exists (
      select 1 from public.import_documents d
      where d.id = public.storage_import_document_id(name)
        and d.session_id = public.storage_import_session_id(name)
        and d.organization_id = public.storage_import_org_id(name)
        -- Fenêtre d'upload uniquement (voir contrat ci-dessus).
        and d.state = 'uploading'
    )
  );

drop policy "imports_update_owner_manager" on storage.objects;

-- UPDATE : la clause USING filtre les lignes cibles ; sans WITH CHECK
-- explicite, Postgres applique la même expression aux nouvelles valeurs.
create policy "imports_update_owner_manager"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'imports'
    and public.storage_import_org_id(name) is not null
    and public.is_org_member(public.storage_import_org_id(name))
    and public.current_org_role(public.storage_import_org_id(name)) in ('owner', 'manager')
    and exists (
      select 1 from public.import_documents d
      where d.id = public.storage_import_document_id(name)
        and d.session_id = public.storage_import_session_id(name)
        and d.organization_id = public.storage_import_org_id(name)
        -- Fenêtre d'upload uniquement (voir contrat ci-dessus).
        and d.state = 'uploading'
    )
  );

commit;
