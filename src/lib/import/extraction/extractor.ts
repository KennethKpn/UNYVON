import { IMPORT_MAX_FILE_BYTES, IMPORT_V1_FORMATS } from "../types";
import { extractTextContent } from "./adapters";
import { validateLlmOutput } from "./output-schema";
import type { Provider } from "./provider";
import type { ExtractedDocument, ExtractionWarning } from "./types";

export type { Provider, ProviderRequest } from "./provider";

// ---------------------------------------------------------------------------
// DocumentExtractor — source de données : Storage/document → lecture →
// extraction → structure intermédiaire validée (Phase 2). Aucune écriture.
// ---------------------------------------------------------------------------

export interface ExtractionInput {
  documentId: string;
  sourceKind: string;
  filename: string;
  bytes: Uint8Array;
}

export interface DocumentExtractor {
  extract(input: ExtractionInput): Promise<ExtractedDocument>;
}

// Limite raisonnable de texte transmis au fournisseur (protection coût V1).
const MAX_PROVIDER_TEXT_CHARS = 50_000;

const UNSUPPORTED_MESSAGE =
  "Format de fichier non supporté (V1 : PDF, DOC, DOCX, MD, JPG, JPEG, PNG, WEBP)";

function imageMimeType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "application/octet-stream";
}

function composeProviderText(
  pages: ExtractedDocument["pages"],
  warnings: ExtractionWarning[]
): string {
  const full = pages
    .map((page) => `[Page ${page.page}]\n${page.text}`)
    .join("\n\n");
  if (full.length <= MAX_PROVIDER_TEXT_CHARS) return full;
  warnings.push({
    code: "TEXT_TRUNCATED",
    message: `Texte tronqué à ${MAX_PROVIDER_TEXT_CHARS} caractères pour le fournisseur IA`,
  });
  return full.slice(0, MAX_PROVIDER_TEXT_CHARS);
}

async function runExtraction(
  input: ExtractionInput,
  provider: Provider | null
): Promise<ExtractedDocument> {
  const document: ExtractedDocument = {
    status: "FAILED",
    documentId: input.documentId,
    sourceKind: input.sourceKind,
    source: "none",
    pages: [],
    candidates: [],
    warnings: [],
    errors: [],
  };
  const fail = (code: string, message: string): ExtractedDocument => {
    document.errors.push({ code, message });
    return document;
  };

  if (input.bytes.length === 0) {
    return fail("EMPTY_DOCUMENT", "Document vide : aucun contenu à extraire");
  }
  if (input.bytes.length > IMPORT_MAX_FILE_BYTES) {
    return fail("FILE_TOO_LARGE", "Fichier trop volumineux (25 Mo maximum)");
  }

  const format = IMPORT_V1_FORMATS.find((f) => {
    const kinds: readonly string[] = f.sourceKinds;
    return kinds.includes(input.sourceKind);
  });
  if (!format) {
    return fail("UNSUPPORTED_FORMAT", UNSUPPORTED_MESSAGE);
  }

  // --- Images : extraction multimodale, uniquement côté serveur -------------
  if (input.sourceKind === "image") {
    document.source = "image-llm";
    if (!provider) {
      document.warnings.push({
        code: "NO_PROVIDER",
        message: "Aucun fournisseur IA configuré : image non extractible",
      });
      return fail(
        "NO_PROVIDER",
        "Fournisseur IA indisponible : impossible de lire cette image"
      );
    }
    let raw: unknown;
    try {
      raw = await provider.parse({
        kind: "image",
        mimeType: imageMimeType(input.filename),
        base64: Buffer.from(input.bytes).toString("base64"),
      });
    } catch (error) {
      return fail("PROVIDER_ERROR", (error as Error).message);
    }
    const validated = validateLlmOutput(raw, input.documentId);
    if (!validated.ok) {
      document.warnings.push({
        code: "INVALID_OUTPUT",
        message: `Sortie modèle refusée : ${validated.issues.join("; ")}`,
      });
      return fail("INVALID_OUTPUT", "Aucune donnée exploitable dans l'image");
    }
    document.candidates = validated.candidates;
    document.status = "SUCCESS";
    return document;
  }

  // --- Formats texte : lecture locale puis structuration optionnelle --------
  const extraction = extractTextContent(input.sourceKind, input.bytes);
  if (!extraction || extraction.pages.length === 0) {
    return fail("UNREADABLE_DOCUMENT", "Document illisible : aucun texte extrait");
  }
  document.source = extraction.source;
  document.pages = extraction.pages;
  document.warnings.push(...extraction.warnings);

  if (!provider) {
    document.warnings.push({
      code: "NO_PROVIDER",
      message:
        "Aucun fournisseur IA configuré : texte extrait sans structuration",
    });
    document.status = "PARTIAL";
    return document;
  }

  const providerText = composeProviderText(document.pages, document.warnings);
  let raw: unknown;
  try {
    raw = await provider.parse({ kind: "text", text: providerText });
  } catch (error) {
    document.errors.push({
      code: "PROVIDER_ERROR",
      message: (error as Error).message,
    });
    document.status = "PARTIAL";
    return document;
  }

  const validated = validateLlmOutput(raw, input.documentId);
  if (!validated.ok) {
    document.warnings.push({
      code: "INVALID_OUTPUT",
      message: `Sortie modèle refusée : ${validated.issues.join("; ")}`,
    });
    document.status = "PARTIAL";
    return document;
  }

  document.candidates = validated.candidates;
  document.status = "SUCCESS";
  return document;
}

export function createDocumentExtractor(deps: { provider: Provider | null }): DocumentExtractor {
  return {
    extract: (input) => runExtraction(input, deps.provider),
  };
}
