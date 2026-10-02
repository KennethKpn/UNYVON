import { createDecompressionBudget, MAX_DECOMPRESSED_BYTES } from "../decompression";
import type { ExtractedPage, ExtractionWarning } from "../types";
import { extractDocText } from "./doc";
import { extractDocxText } from "./docx";
import { extractMarkdownText } from "./markdown";
import { extractPdfPages } from "./pdf";

// ---------------------------------------------------------------------------
// Adaptateurs par format — chaque adaptateur ne fait que LIRE le document.
// L'image n'a pas d'adaptateur local : elle exige le fournisseur IA (serveur).
// ---------------------------------------------------------------------------

export interface AdapterResult {
  pages: ExtractedPage[];
  warnings: ExtractionWarning[];
  source: string;
  error?: { code: string; message: string };
}

function singlePage(text: string, warnings: ExtractionWarning[], source: string): AdapterResult | null {
  if (!text.trim()) return null;
  return { pages: [{ page: 1, text: text.trim() }], warnings, source };
}

function decompressionError(source: string, warnings: ExtractionWarning[]): AdapterResult {
  return {
    pages: [],
    warnings,
    source,
    error: {
      code: "DECOMPRESSION_LIMIT_EXCEEDED",
      message: `Décompression refusée : limite documentaire de ${MAX_DECOMPRESSED_BYTES / (1024 * 1024)} MiB dépassée (protection anti zip-bomb)`,
    },
  };
}

export function extractTextContent(
  sourceKind: string,
  bytes: Uint8Array
): AdapterResult | null {
  // Budget documentaire UNIQUE : créé une fois par document, partagé par
  // toutes les décompressions (PDF multi-flux, DOCX). Jamais recréé.
  const budget = createDecompressionBudget();
  switch (sourceKind) {
    case "md":
      return singlePage(extractMarkdownText(bytes), [], "markdown-local");
    case "pdf": {
      const result = extractPdfPages(bytes, budget);
      if (result.budgetExceeded) return decompressionError("pdf-local", []);
      if (result.pages.length === 0) return null;
      return { pages: result.pages, warnings: [], source: "pdf-local" };
    }
    case "docx": {
      const warnings: ExtractionWarning[] = [
        {
          code: "PAGES_UNAVAILABLE",
          message:
            "La pagination native d'un DOCX n'est pas disponible : texte extrait en page unique",
        },
      ];
      const result = extractDocxText(bytes, budget);
      if (result.budgetExceeded) return decompressionError("docx-local", warnings);
      return singlePage(result.text ?? "", warnings, "docx-local");
    }
    case "doc":
      return singlePage(
        extractDocText(bytes),
        [
          {
            code: "DOC_BEST_EFFORT",
            message:
              "Format DOC binaire : extraction best-effort des chaînes lisibles",
          },
        ],
        "doc-local"
      );
    default:
      return null;
  }
}
