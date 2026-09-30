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
}

function singlePage(text: string, warnings: ExtractionWarning[], source: string): AdapterResult | null {
  if (!text.trim()) return null;
  return { pages: [{ page: 1, text: text.trim() }], warnings, source };
}

export function extractTextContent(
  sourceKind: string,
  bytes: Uint8Array
): AdapterResult | null {
  switch (sourceKind) {
    case "md":
      return singlePage(extractMarkdownText(bytes), [], "markdown-local");
    case "pdf": {
      const pages = extractPdfPages(bytes);
      if (pages.length === 0) return null;
      return { pages, warnings: [], source: "pdf-local" };
    }
    case "docx":
      return singlePage(
        extractDocxText(bytes) ?? "",
        [
          {
            code: "PAGES_UNAVAILABLE",
            message:
              "La pagination native d'un DOCX n'est pas disponible : texte extrait en page unique",
          },
        ],
        "docx-local"
      );
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
