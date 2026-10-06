import type { ImportFieldProvenance, ImportEntityType } from "../types";
import type { ProviderErrorDetails } from "./provider";

// ---------------------------------------------------------------------------
// Contrat d'extraction (Phase 4) — l'extracteur est une source de données :
// aucune autorité d'écriture sur le domaine métier.
// ---------------------------------------------------------------------------

export type ExtractionStatus = "SUCCESS" | "PARTIAL" | "FAILED";

export interface ExtractionWarning {
  code: string;
  message: string;
  page?: number | null;
}

export interface ExtractionError {
  code: string;
  message: string;
  provider?: ProviderErrorDetails;
}

export interface ExtractedPage {
  page: number;
  text: string;
}

export interface ExtractedCandidate {
  entityType: ImportEntityType;
  fields: Partial<Record<string, ImportFieldProvenance>>;
  documentId: string;
  page: number | null;
}

export interface ExtractedDocument {
  status: ExtractionStatus;
  documentId: string;
  sourceKind: string;
  source: string;
  pages: ExtractedPage[];
  candidates: ExtractedCandidate[];
  warnings: ExtractionWarning[];
  errors: ExtractionError[];
}
