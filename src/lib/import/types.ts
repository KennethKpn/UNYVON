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

export interface DatabaseImportErrorDetails {
  provider: string;
  model: string;
  category: string;
  retryable: boolean;
  status?: number;
  providerCode?: string;
  retryAfterMs?: number;
  requestId?: string;
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
  processing_lease_id: string | null;
  processing_lease_expires_at: string | null;
  error_code: string | null;
  error_details: DatabaseImportErrorDetails | null;
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
  processingLeaseId: string | null;
  processingLeaseExpiresAt: string | null;
  errorCode: string | null;
  errorDetails: DatabaseImportErrorDetails | null;
  errorMessage: string | null;
  processedAt: string | null;