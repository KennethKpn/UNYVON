// Types domaine du Smart Data Import — alignés sur
// supabase/migrations/0011_import.sql (Phase import 1).
// Les valeurs littérales des listes doivent rester identiques aux enums SQL :
// schemas.test.ts les verrouille.

export const IMPORT_SESSION_STATES = [
  "collecting",
  "processing",
  "needs_review",
  "ready",
  "importing",
  "completed",
  "failed",
  "cancelled",
] as const;
export type ImportSessionState = (typeof IMPORT_SESSION_STATES)[number];

export const IMPORT_DOCUMENT_STATES = [
  "uploading",
  "uploaded",
  "parsing",
  "parsed",
  "extracting",
  "extracted",
  "failed",
] as const;
export type ImportDocumentState = (typeof IMPORT_DOCUMENT_STATES)[number];

export const IMPORT_SOURCE_KINDS = [
  "pdf",
  "docx",
  "doc",
  "md",
  "image",
] as const;
export type ImportSourceKind = (typeof IMPORT_SOURCE_KINDS)[number];

export const IMPORT_ENTITY_TYPES = [
  "category",
  "product",
  "customer",
  "supplier",
] as const;
export type ImportEntityType = (typeof IMPORT_ENTITY_TYPES)[number];

export const IMPORT_ITEM_ACTIONS = [
  "create",
  "use_existing",
  "update",
  "ignore",
] as const;
export type ImportItemAction = (typeof IMPORT_ITEM_ACTIONS)[number];

export const IMPORT_ITEM_STATUSES = [
  "pending",
  "validated",
  "ignored",
  "imported",
  "failed",
] as const;
export type ImportItemStatus = (typeof IMPORT_ITEM_STATUSES)[number];

export const IMPORT_FIELD_CONFIDENCES = [
  "high",
  "medium",
  "low",
  "missing",
] as const;
export type ImportFieldConfidence = (typeof IMPORT_FIELD_CONFIDENCES)[number];

// Bucket `imports` : file_size_limit 26214400 (25 Mo) — 0011_import.sql.
export const IMPORT_MAX_FILE_BYTES = 25 * 1024 * 1024;

// Formats V1 acceptés (extension → MIME exact → source_kind SQL autorisé).
// Une extension n'accepte QUE ses MIME listés : jamais d'incohérence
// MIME/extension à l'insertion.
export const IMPORT_V1_FORMATS = [
  { extension: "pdf", mimeTypes: ["application/pdf"], sourceKinds: ["pdf"] },
  { extension: "doc", mimeTypes: ["application/msword"], sourceKinds: ["doc"] },
  {
    extension: "docx",
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    sourceKinds: ["docx"],
  },
  {
    extension: "md",
    mimeTypes: ["text/markdown", "text/x-markdown", "text/plain"],
    sourceKinds: ["md"],
  },
  { extension: "jpg", mimeTypes: ["image/jpeg"], sourceKinds: ["image"] },
  { extension: "jpeg", mimeTypes: ["image/jpeg"], sourceKinds: ["image"] },
  { extension: "png", mimeTypes: ["image/png"], sourceKinds: ["image"] },
  { extension: "webp", mimeTypes: ["image/webp"], sourceKinds: ["image"] },
] as const;

// Colonnes cibles commitables par type d'entité (tables 0002/0003).
// Règle « jamais d'invention » : un champ absent du document n'est pas
// inventé, il porte confidence 'missing' + warning. Une référence vers une
// table existante se fait par NOM (category → resolution par nom au commit),
// jamais par uuid.
export const IMPORT_TARGET_FIELDS = {
  category: ["name"],
  product: [
    "name",
    "unit",
    "cost_price",
    "sale_price",
    "min_stock_threshold",
    "stock_quantity",
    "category",
  ],
  customer: ["name", "phone", "email", "address", "notes"],
  supplier: ["name", "phone", "email", "address", "notes"],
} as const satisfies Record<ImportEntityType, readonly string[]>;

// ---------------------------------------------------------------------------
// Provenance par champ (import_items.fields, jsonb) — cf. 0011_import.sql
// ---------------------------------------------------------------------------

export interface ImportFieldProvenance {
  raw: string;
  normalized?: string | number | null;
  confidence: ImportFieldConfidence;
  warning?: string | null;
  page?: number | null;
}

// Proposition de rapprochement (import_items.match, jsonb) — cf. 0011_import.sql
export interface ImportItemMatch {
  existing_id: string | null;
  existing_name: string | null;
  score: number;
  reason?: string | null;
}

// ---------------------------------------------------------------------------
// Rows DB (snake_case) — miroir de 0011_import.sql
// ---------------------------------------------------------------------------

export interface DatabaseImportSession {
  id: string;
  organization_id: string;
  created_by: string;
  state: ImportSessionState;
  created_at: string;
  updated_at: string;
}

export interface ImportParsedPage {
  page: number;
  text: string;
}

export interface ImportParsedWarning {
  code: string;
  message: string;
  page?: number | null;
}

export interface ImportParsedArtifact {
  version: 1;
  source: string;
  pages: ImportParsedPage[];
  warnings: ImportParsedWarning[];
}

export interface DatabaseImportDocument {
  id: string;
  session_id: string;
  organization_id: string;
  original_name: string;
  source_kind: ImportSourceKind;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  state: ImportDocumentState;
  page_count: number | null;
  parsed_artifact: ImportParsedArtifact | null;
  parsed_at: string | null;
  error_message: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DatabaseImportItem {
  id: string;
  session_id: string;
  document_id: string;
  organization_id: string;
  entity_type: ImportEntityType;
  source_page: number | null;
  fields: Record<string, ImportFieldProvenance>;
  match: ImportItemMatch | null;
  action: ImportItemAction;
  status: ImportItemStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Domaine (camelCase) — aligné sur la convention de src/types/index.ts
// ---------------------------------------------------------------------------

export interface ImportSession {
  id: string;
  organizationId: string;
  createdBy: string;
  state: ImportSessionState;
  createdAt: string;
  updatedAt: string;
}

export interface ImportDocument {
  id: string;
  sessionId: string;
  organizationId: string;
  originalName: string;
  sourceKind: ImportSourceKind;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  state: ImportDocumentState;
  pageCount: number | null;
  parsedArtifact: ImportParsedArtifact | null;
  parsedAt: string | null;
  errorMessage: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportItem {
  id: string;
  sessionId: string;
  documentId: string;
  organizationId: string;
  entityType: ImportEntityType;
  sourcePage: number | null;
  fields: Record<string, ImportFieldProvenance>;
  match: ImportItemMatch | null;
  action: ImportItemAction;
  status: ImportItemStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}
