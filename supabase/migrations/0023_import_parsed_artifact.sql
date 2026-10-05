-- ============================================================================
-- UNYVON — SMART DATA IMPORT 0023
-- Durable local parsing artifact.
--
-- Objectif :
--   * conserver le résultat de lecture locale avant tout appel IA ;
--   * rendre une panne fournisseur / un crash après parsing réellement
--     reprenable sans reparcourir le document ;
--   * conserver le texte/page provenance sous le contrôle RLS de
--     import_documents (aucune nouvelle surface de lecture).
--
-- Aucun changement aux tables métier, aux RPC de matching/review/commit,
-- ni aux policies d'organisation.
-- ============================================================================

begin;

alter table public.import_documents
  add column if not exists parsed_artifact jsonb,
  add column if not exists parsed_at timestamptz;

alter table public.import_documents
  drop constraint if exists import_documents_parsed_artifact_object_check;

alter table public.import_documents
  add constraint import_documents_parsed_artifact_object_check
  check (
    parsed_artifact is null
    or pg_catalog.jsonb_typeof(parsed_artifact) = 'object'
  );

comment on column public.import_documents.parsed_artifact is
  'Versioned durable result of local document parsing: {version,source,pages,warnings}. Never contains provider credentials or external identifiers.';

comment on column public.import_documents.parsed_at is
  'Timestamp of the last successful local parsing artifact persistence.';

create index if not exists import_documents_parsed_state_idx
  on public.import_documents(state, parsed_at);

commit;
