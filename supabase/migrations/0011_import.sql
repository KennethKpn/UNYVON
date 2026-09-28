-- ============================================================================
-- UNYVON — PHASE SMART DATA IMPORT 1 : Sessions d'import, documents, items
-- Tables : import_sessions, import_documents, import_items
-- + RLS (owner/manager, isolation multi-tenant)
-- + Bucket Storage privé `imports` + policies chemins organizations/{org}/...
-- + Aucune écriture directe dans products/customers/suppliers/categories :
--   ces tables ne sont touchées que par la RPC import_commit (Phase import 14)
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
create type public.import_session_state as enum (
  'collecting',    -- collecte des documents (ajout/suppression fichiers)
  'processing',    -- extraction IA en cours
  'needs_review',  -- extraction terminée, validation utilisateur requise
  'ready',         -- tous les items validés/ignorés, import autorisé
  'importing',     -- commit RPC en cours
  'completed',     -- import appliqué
  'failed',        -- échec (rejouable)
  'cancelled'      -- abandonné par l'utilisateur
);

create type public.import_document_state as enum (
  'uploading',   -- row créée, upload Storage en cours
  'uploaded',    -- fichier stocké, prêt à être lu
  'parsing',     -- extraction texte/images en cours
  'parsed',      -- texte extrait, en attente structuration IA
  'extracting',  -- structuration IA en cours
  'extracted',   -- items produits
  'failed'       -- échec (message d'erreur ci-dessous)
);

create type public.import_entity_type as enum (
  'category',
  'product',
  'customer',
  'supplier'
);

create type public.import_item_action as enum (
  'create',        -- créer une nouvelle entité
  'use_existing',  -- rattacher à une entité déjà existante (aucune création)
  'update',        -- modifier explicitement une entité existante (choix utilisateur)
  'ignore'         -- ne pas importer cette ligne
);

create type public.import_item_status as enum (
  'pending',    -- extrait, pas encore décidé/validé
  'validated',  -- validé par l'utilisateur, prêt pour le commit
  'ignored',    -- exclu par l'utilisateur
  'imported',   -- appliqué par import_commit
  'failed'      -- échec du commit pour cette ligne (détail en error_message)
);

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

-- Session d'import = un parcours complet (collecte → review → commit)
create table public.import_sessions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by      uuid not null references auth.users(id) on delete cascade,
  state           public.import_session_state not null default 'collecting',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint import_sessions_id_org_unique unique (id, organization_id)
);
create index import_sessions_org_idx on public.import_sessions(organization_id);
create index import_sessions_org_created_idx on public.import_sessions(organization_id, created_at desc);

-- Document source (PDF, Word, Markdown, photo) rangé dans Storage
create table public.import_documents (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.import_sessions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  original_name   text not null check (length(trim(original_name)) > 0),
  source_kind     text not null check (source_kind in ('pdf', 'docx', 'doc', 'md', 'image')),
  mime_type       text not null,
  size_bytes      bigint not null check (size_bytes > 0),
  storage_path    text not null,
  state           public.import_document_state not null default 'uploading',
  page_count      integer check (page_count >= 0),
  error_message   text,
  processed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint import_documents_path_unique unique (storage_path),
  constraint import_documents_id_session_unique unique (id, session_id),
  -- un document appartient à une session ET à l'org de cette session
  constraint import_documents_session_org_fkey
    foreign key (session_id, organization_id)
    references public.import_sessions (id, organization_id) on delete cascade
);
create index import_documents_session_idx on public.import_documents(session_id);
create index import_documents_session_state_idx on public.import_documents(session_id, state);

-- Item extrait = une entité candidate (catégorie, produit, client, fournisseur).
-- `fields` (jsonb) porte la provenance PAR CHAMP :
--   { "sale_price": {
--        "raw": "18 500 F",           -- valeur brute du document
--        "normalized": 18500,          -- normalisation déterministe (niveau B)
--        "confidence": "high",         -- high | medium | low | missing
--        "warning": null,              -- texte d'avertissement si ambigu
--        "page": 3                     -- page de provenance (sinon source_page)
--     }, ... }
-- `match` (jsonb) porte la proposition de rapprochement :
--   { "existing_id": uuid|null, "existing_name": "...", "score": 0.92, "reason": "..." }
-- Règle produit : jamais d'invention (prix, unité, stock, catégorie, fournisseur)
-- non présents dans le document ; confidence 'missing' + warning si absent.
create table public.import_items (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.import_sessions(id) on delete cascade,
  document_id     uuid not null references public.import_documents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type     public.import_entity_type not null,
  source_page     integer,
  fields          jsonb not null default '{}'::jsonb,
  match           jsonb,
  action          public.import_item_action not null default 'create',
  status          public.import_item_status not null default 'pending',
  error_message   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- un item appartient à une session ET à l'org de cette session...
  constraint import_items_session_org_fkey
    foreign key (session_id, organization_id)
    references public.import_sessions (id, organization_id) on delete cascade,
  -- ...et son document doit appartenir à cette même session (jamais de cross-session)
  constraint import_items_document_session_fkey
    foreign key (document_id, session_id)
    references public.import_documents (id, session_id) on delete cascade
);
create index import_items_session_idx on public.import_items(session_id);
create index import_items_document_idx on public.import_items(document_id);
create index import_items_session_entity_idx on public.import_items(session_id, entity_type);
create index import_items_session_status_idx on public.import_items(session_id, status);
create index import_items_org_idx on public.import_items(organization_id);

-- ---------------------------------------------------------------------------
-- 3. updated_at automatisé
-- ---------------------------------------------------------------------------
create trigger import_sessions_set_updated_at
  before update on public.import_sessions
  for each row execute function public.set_updated_at();

create trigger import_documents_set_updated_at
  before update on public.import_documents
  for each row execute function public.set_updated_at();

create trigger import_items_set_updated_at
  before update on public.import_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. RLS : owner/manager uniquement (fonctionnalité d'administration)
-- ---------------------------------------------------------------------------
alter table public.import_sessions  enable row level security;
alter table public.import_documents enable row level security;
alter table public.import_items     enable row level security;

create policy "import_sessions_select_owner_manager"
  on public.import_sessions for select
  to authenticated
  using (
    public.is_org_member(organization_id)
    and public.current_org_role(organization_id) in ('owner', 'manager')
  );

create policy "import_sessions_insert_owner_manager"
  on public.import_sessions for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.is_org_member(organization_id)
    and public.current_org_role(organization_id) in ('owner', 'manager')
  );

create policy "import_sessions_update_owner_manager"
  on public.import_sessions for update
  to authenticated
  using (
    public.is_org_member(organization_id)
    and public.current_org_role(organization_id) in ('owner', 'manager')
  );

create policy "import_sessions_delete_owner_manager"
  on public.import_sessions for delete
  to authenticated
  using (
    public.is_org_member(organization_id)
    and public.current_org_role(organization_id) in ('owner', 'manager')
  );

create policy "import_documents_select_owner_manager"
  on public.import_documents for select
  to authenticated
  using (
    public.is_org_member(organization_id)
    and public.current_org_role(organization_id) in ('owner', 'manager')
  );

create policy "import_documents_insert_owner_manager"
  on public.import_documents for insert
  to authenticated
  with check (
    public.is_org_member(organization_id)
    and public.current_org_role(organization_id) in ('owner', 'manager')
  );

create policy "import_documents_update_owner_manager"
  on public.import_documents for update
  to authenticated
  using (
    public.is_org_member(organization_id)
    and public.current_org_role(organization_id) in ('owner', 'manager')
  );

create policy "import_documents_delete_owner_manager"
  on public.import_documents for delete
  to authenticated
  using (
    public.is_org_member(organization_id)
    and public.current_org_role(organization_id) in ('owner', 'manager')
  );

create policy "import_items_select_owner_manager"
  on public.import_items for select
  to authenticated
  using (
    public.is_org_member(organization_id)
    and public.current_org_role(organization_id) in ('owner', 'manager')
  );

create policy "import_items_insert_owner_manager"
  on public.import_items for insert
  to authenticated
  with check (
    public.is_org_member(organization_id)
    and public.current_org_role(organization_id) in ('owner', 'manager')
  );

create policy "import_items_update_owner_manager"
  on public.import_items for update
  to authenticated
  using (
    public.is_org_member(organization_id)
    and public.current_org_role(organization_id) in ('owner', 'manager')
  );

create policy "import_items_delete_owner_manager"
  on public.import_items for delete
  to authenticated
  using (
    public.is_org_member(organization_id)
    and public.current_org_role(organization_id) in ('owner', 'manager')
  );

-- ---------------------------------------------------------------------------
-- 5. Bucket Storage privé `imports`
--    Chemin imposé : organizations/{orgId}/imports/{sessionId}/documents/{documentId}
--    (aucun objet public ; lectures via API Storage authentifiée / URL signée)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('imports', 'imports', false, 26214400)  -- 25 Mo max / fichier
on conflict (id) do nothing;

-- Parse le chemin d'un objet import : renvoie l'org uniquement si la structure
-- complète est respectée (sinon NULL → la policy refuse, sans erreur de cast).
create or replace function public.storage_import_org_id(object_name text)
returns uuid
language sql
immutable
as $$
  select case
    when object_name ~ '^organizations/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/imports/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/documents/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[^/]+$'
    then (regexp_match(object_name, '^organizations/([0-9a-fA-F-]{36})/'))[1]::uuid
  end;
$$;

create or replace function public.storage_import_document_id(object_name text)
returns uuid
language sql
immutable
as $$
  select case
    when object_name ~ '^organizations/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/imports/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/documents/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[^/]+$'
    then (regexp_match(object_name, '/documents/([0-9a-fA-F-]{36})/'))[1]::uuid
  end;
$$;

create or replace function public.storage_import_session_id(object_name text)
returns uuid
language sql
immutable
as $$
  select case
    when object_name ~ '^organizations/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/imports/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/documents/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[^/]+$'
    then (regexp_match(object_name, '/imports/([0-9a-fA-F-]{36})/'))[1]::uuid
  end;
$$;

-- L'objet ne peut exister que si la row import_documents correspondante existe
-- déjà (créée par la server action, état 'uploading') ET que son id, sa session
-- et son org correspondent EXACTEMENT au chemin, ET que l'utilisateur est
-- owner/manager de cette org → zéro objet orphelin, zéro écriture hors org.
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
    )
  );

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
    )
  );

create policy "imports_select_owner_manager"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'imports'
    and public.storage_import_org_id(name) is not null
    and public.is_org_member(public.storage_import_org_id(name))
    and public.current_org_role(public.storage_import_org_id(name)) in ('owner', 'manager')
  );

create policy "imports_delete_owner_manager"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'imports'
    and public.storage_import_org_id(name) is not null
    and public.is_org_member(public.storage_import_org_id(name))
    and public.current_org_role(public.storage_import_org_id(name)) in ('owner', 'manager')
  );

commit;
