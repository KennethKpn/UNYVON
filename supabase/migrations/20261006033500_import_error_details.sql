begin;

alter table public.import_documents
  add column if not exists error_code text,
  add column if not exists error_details jsonb;

alter table public.import_documents
  drop constraint if exists import_documents_error_details_object_chk;

alter table public.import_documents
  add constraint import_documents_error_details_object_chk
  check (
    error_details is null
    or pg_catalog.jsonb_typeof(error_details) = 'object'
  );

comment on column public.import_documents.error_code
is 'Code machine-readable du dernier échec de traitement ; nul hors erreur.';

comment on column public.import_documents.error_details
is 'Diagnostics structurés non secrets du dernier échec de traitement ; nul hors erreur.';

commit;