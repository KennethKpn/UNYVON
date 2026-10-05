import { z } from "zod";
import {
  IMPORT_MAX_FILE_BYTES,
  IMPORT_V1_FORMATS,
  type ImportParsedArtifact,
} from "../types";
import { extractTextContent } from "./adapters";
import { validateLlmOutput, verifyProvenanceAgainstPages } from "./output-schema";
import type { Provider } from "./provider";
import type {
  ExtractedDocument,
  ExtractedPage,
  ExtractionError,
  ExtractionWarning,
} from "./types";

export type { Provider, ProviderRequest } from "./provider";

// ---------------------------------------------------------------------------
// DocumentExtractor — source de données : Storage/document → lecture →
// extraction → structure intermédiaire validée (Phase 2). Aucune écriture.
//
// Le parsing local et la structuration IA sont volontairement séparés afin que
// le résultat de lecture puisse être persisté puis réutilisé lors d'une reprise.
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

export type LocalParseResult =
  | {
      status: "READY";
      artifact: ImportParsedArtifact;
    }
  | {
      status: "VISION_REQUIRED";
      artifact: ImportParsedArtifact;
    }
  | {
      status: "FAILED";
      errors: ExtractionError[];
      warnings: ExtractionWarning[];
      source: string;
      pages: ExtractedPage[];
    };

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

// Un document importé PEUT contenir littéralement "[Page 42]" (référence
// d'annexe, table des matières, ou tentative d'usurper la pagination). Le
// marqueur applicatif reste le seul émis ; toute occurrence visuellement
// identique dans le texte importé est échappée pour ne jamais pouvoir être
// confondue avec une vraie pagination.
function escapeForgedPageMarkers(text: string): string {
  return text.replace(/\[(?=Page\s+\d+\])/g, "\\[");
}

function composeProviderText(
  pages: ExtractedDocument["pages"],
  warnings: ExtractionWarning[]
): string {
  const chunks = composeProviderTextChunks(pages, warnings);
  return chunks[0] ?? "";
}

export function composeProviderTextChunks(
  pages: ExtractedDocument["pages"],
  warnings: ExtractionWarning[]
): string[] {
  const pageBlocks = pages.map(
    (page) => `[Page ${page.page}]\n${escapeForgedPageMarkers(page.text)}`
  );
  const chunks: string[] = [];
  let current = "";

  const push = (value: string) => {
    if (!value) return;
    chunks.push(value);
  };

  for (const block of pageBlocks) {
    if (block.length > MAX_PROVIDER_TEXT_CHARS) {
      if (current) {
        push(current);
        current = "";
      }

      warnings.push({
        code: "TEXT_CHUNKED",
        message:
          "Document volumineux : la structuration IA est découpée en plusieurs segments afin de ne perdre aucune page.",
      });

      const prefixMatch = block.match(/^\[Page \d+\]\n/);
      const prefix = prefixMatch?.[0] ?? "";
      const body = block.slice(prefix.length);

      for (let offset = 0; offset < body.length; offset += MAX_PROVIDER_TEXT_CHARS - prefix.length) {
        push(prefix + body.slice(offset, offset + MAX_PROVIDER_TEXT_CHARS - prefix.length));
      }
      continue;
    }

    if (!current) {
      current = block;
      continue;
    }

    const candidate = `${current}\n\n${block}`;
    if (candidate.length <= MAX_PROVIDER_TEXT_CHARS) {
      current = candidate;
    } else {
      push(current);
      current = block;
      warnings.push({
        code: "TEXT_CHUNKED",
        message:
          "Document volumineux : la structuration IA est découpée en plusieurs segments afin de ne perdre aucune page.",
      });
    }
  }

  if (current) push(current);
  return chunks.length > 0 ? chunks : [""];
}
function buildFailed(
  input: ExtractionInput,
  source: string,
  pages: ExtractedPage[],
  warnings: ExtractionWarning[],
  errors: ExtractionError[]
): ExtractedDocument {
  return {
    status: "FAILED",
    documentId: input.documentId,
    sourceKind: input.sourceKind,
    source,
    pages,
    candidates: [],
    warnings,
    errors,
  };
}

function buildPartial(
  input: ExtractionInput,
  artifact: ImportParsedArtifact,
  warnings: ExtractionWarning[] = [...artifact.warnings],
  errors: ExtractionError[] = []
): ExtractedDocument {
  return {
    status: "PARTIAL",
    documentId: input.documentId,
    sourceKind: input.sourceKind,
    source: artifact.source,
    pages: artifact.pages,
    candidates: [],
    warnings,
    errors,
  };
}

export function parseDocumentLocally(input: ExtractionInput): LocalParseResult {
  const baseWarnings: ExtractionWarning[] = [];

  if (input.bytes.length === 0) {
    return {
      status: "FAILED",
      errors: [{ code: "EMPTY_DOCUMENT", message: "Document vide : aucun contenu à extraire" }],
      warnings: baseWarnings,
      source: "none",
      pages: [],
    };
  }

  if (input.bytes.length > IMPORT_MAX_FILE_BYTES) {
    return {
      status: "FAILED",
      errors: [{ code: "FILE_TOO_LARGE", message: "Fichier trop volumineux (25 Mo maximum)" }],
      warnings: baseWarnings,
      source: "none",
      pages: [],
    };
  }

  const format = IMPORT_V1_FORMATS.find((candidate) => {
    const kinds: readonly string[] = candidate.sourceKinds;
    return kinds.includes(input.sourceKind);
  });
  if (!format) {
    return {
      status: "FAILED",
      errors: [{ code: "UNSUPPORTED_FORMAT", message: UNSUPPORTED_MESSAGE }],
      warnings: baseWarnings,
      source: "none",
      pages: [],
    };
  }

  if (input.sourceKind === "image") {
    return {
      status: "VISION_REQUIRED",
      artifact: {
        version: 1,
        source: "image-llm",
        pages: [],
        warnings: [],
      },
    };
  }

  const extraction = extractTextContent(input.sourceKind, input.bytes);
  if (extraction?.error) {
    return {
      status: "FAILED",
      errors: [{ code: extraction.error.code, message: extraction.error.message }],
      warnings: extraction.warnings,
      source: extraction.source,
      pages: extraction.pages,
    };
  }

  if (!extraction || extraction.pages.length === 0) {
    if (input.sourceKind === "pdf") {
      return {
        status: "VISION_REQUIRED",
        artifact: {
          version: 1,
          source: "pdf-llm",
          pages: [],
          warnings: [
            {
              code: "PDF_VISION_FALLBACK",
              message:
                "Lecture locale du PDF sans texte exploitable : analyse visuelle Gemini utilisée en secours.",
            },
          ],
        },
      };
    }

    return {
      status: "FAILED",
      errors: [
        {
          code: "UNREADABLE_DOCUMENT",
          message: "Document illisible : aucun texte extrait",
        },
      ],
      warnings: extraction?.warnings ?? [],
      source: extraction?.source ?? "none",
      pages: extraction?.pages ?? [],
    };
  }

  return {
    status: "READY",
    artifact: {
      version: 1,
      source: extraction.source,
      pages: extraction.pages,
      warnings: extraction.warnings,
    },
  };
}

export function parsePersistedArtifact(value: unknown): ImportParsedArtifact | null {
  const pageSchema = z.strictObject({
    page: z.number().int().min(1),
    text: z.string(),
  });

  const warningSchema = z.strictObject({
    code: z.string().min(1),
    message: z.string().min(1),
    page: z.number().int().min(1).nullable().optional(),
  });

  const schema = z.strictObject({
    version: z.literal(1),
    source: z.string().min(1),
    pages: z.array(pageSchema),
    warnings: z.array(warningSchema),
  });

  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function structureParsedDocument(
  input: ExtractionInput,
  artifact: ImportParsedArtifact,
  provider: Provider | null
): Promise<ExtractedDocument> {
  const document: ExtractedDocument = {
    status: "FAILED",
    documentId: input.documentId,
    sourceKind: input.sourceKind,
    source: artifact.source,
    pages: artifact.pages,
    candidates: [],
    warnings: [...artifact.warnings],
    errors: [],
  };

  const fail = (code: string, message: string): ExtractedDocument => {
    document.errors.push({ code, message });
    return document;
  };

  if (!provider) {
    document.warnings.push({
      code: "NO_PROVIDER",
      message:
        "Aucun fournisseur IA configuré : texte extrait sans structuration",
    });
    document.status = "PARTIAL";
    return document;
  }

  // Les deux voies multimodales nécessitent encore le binaire original.
  if (artifact.source === "image-llm" || artifact.source === "pdf-llm") {
    const request =
      artifact.source === "image-llm"
        ? {
            kind: "image" as const,
            mimeType: imageMimeType(input.filename),
            base64: Buffer.from(input.bytes).toString("base64"),
          }
        : {
            kind: "document" as const,
            mimeType: "application/pdf",
            base64: Buffer.from(input.bytes).toString("base64"),
          };

    let raw: unknown;
    try {
      raw = await provider.parse(request);
    } catch (error) {
      return fail("PROVIDER_ERROR", (error as Error).message);
    }

    const validated = validateLlmOutput(raw, input.documentId);
    if (!validated.ok) {
      document.warnings.push({
        code: "INVALID_OUTPUT",
        message: `Sortie modèle refusée : ${validated.issues.join("; ")}`,
      });
      return fail(
        "INVALID_OUTPUT",
        artifact.source === "image-llm"
          ? "Aucune donnée exploitable dans l'image"
          : "Aucune donnée exploitable dans le PDF"
      );
    }

    document.candidates =
      artifact.pages.length > 0
        ? verifyProvenanceAgainstPages(validated.candidates, artifact.pages)
        : validated.candidates;
    document.status = "SUCCESS";
    return document;
  }

  if (artifact.pages.length === 0) {
    return fail("UNREADABLE_DOCUMENT", "Document illisible : aucun texte extrait");
  }

  const providerTexts = composeProviderTextChunks(
    document.pages,
    document.warnings
  );

  const candidates = [];
  for (const providerText of providerTexts) {
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

    candidates.push(...validated.candidates);
  }

  document.candidates = verifyProvenanceAgainstPages(
    candidates,
    document.pages
  );
  document.status = "SUCCESS";
  return document;
}

async function runExtraction(
  input: ExtractionInput,
  provider: Provider | null
): Promise<ExtractedDocument> {
  const local = parseDocumentLocally(input);

  if (local.status === "FAILED") {
    return buildFailed(
      input,
      local.source,
      local.pages,
      local.warnings,
      local.errors
    );
  }

  if (local.status === "VISION_REQUIRED" && !provider) {
    return buildFailed(
      input,
      local.artifact.source,
      local.artifact.pages,
      local.artifact.warnings,
      [
        {
          code: "NO_PROVIDER",
          message: "Fournisseur IA indisponible : cette source nécessite une analyse multimodale",
        },
      ]
    );
  }

  return structureParsedDocument(input, local.artifact, provider);
}

export function createDocumentExtractor(deps: {
  provider: Provider | null;
}): DocumentExtractor {
  return {
    extract: (input) => runExtraction(input, deps.provider),
  };
}
