// ============================================================================
// Smart Data Import — Phase 4 : extraction (source de données, lecture seule)
// Storage/document → lecture → extraction → structure intermédiaire validée
// ============================================================================

export type {
  ExtractedCandidate,
  ExtractedDocument,
  ExtractedPage,
  ExtractionError,
  ExtractionStatus,
  ExtractionWarning,
} from "./types";

export type { ExtractionInput, DocumentExtractor } from "./extractor";
export { createDocumentExtractor } from "./extractor";

export type { Provider, ProviderRequest, ProviderConfig } from "./provider";
export {
  createDefaultProvider,
  createProviderFromConfig,
  resolveProviderConfig,
} from "./provider";

export type { ValidateLlmResult } from "./output-schema";
export { llmExtractionOutputSchema, validateLlmOutput } from "./output-schema";
