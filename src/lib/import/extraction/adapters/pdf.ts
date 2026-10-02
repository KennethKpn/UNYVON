import type { DecompressionBudget } from "../decompression";
import type { ExtractedPage } from "../types";

// ---------------------------------------------------------------------------
// Extracteur PDF minimal (sans dépendance) : conserve la pagination réelle
// via les objets /Type /Page et leurs flux /Contents (FlateDecode supporté).
// Toutes les décompressions passent par le budget documentaire partagé :
// un flux dont la sortie dépasse le budget restant est bloqué et arrête
// proprement l'extraction (aucune sortie exploitable n'est produite).
// ---------------------------------------------------------------------------

interface StreamResult {
  text: string;
  budgetExceeded: boolean;
}

function decodePdfString(raw: string): string {
  return raw.replace(/\\([nrtbf()\\]|(\d{1,3}))/g, (_match, esc: string) => {
    if (esc === "n") return "\n";
    if (esc === "r") return "\r";
    if (esc === "t") return "\t";
    if (esc === "b") return "\b";
    if (esc === "f") return "\f";
    if (esc === "(") return "(";
    if (esc === ")") return ")";
    if (esc === "\\") return "\\";
    const octal = parseInt(esc, 8);
    return Number.isNaN(octal) ? "" : String.fromCharCode(octal);
  });
}

function streamContent(objectBody: string, budget: DecompressionBudget): StreamResult {
  const match = objectBody.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
  if (!match) return { text: "", budgetExceeded: false };
  const data = Buffer.from(match[1], "latin1");
  if (/\/Filter\s*\/FlateDecode/.test(objectBody.slice(0, match.index ?? 0))) {
    const outcome = budget.inflate(data);
    if (!outcome.ok) {
      return {
        text: "",
        budgetExceeded: outcome.reason === "DECOMPRESSION_BUDGET_EXCEEDED",
      };
    }
    return { text: outcome.data?.toString("latin1") ?? "", budgetExceeded: false };
  }
  return { text: data.toString("latin1"), budgetExceeded: false };
}

function decodeTextOperators(content: string): string {
  const fragments: string[] = [];
  const tjRe = /\(((?:\\.|[^\\()])*)\)\s*Tj/g;
  let match: RegExpExecArray | null;
  while ((match = tjRe.exec(content)) !== null) {
    fragments.push(decodePdfString(match[1]));
  }
  const tjArrayRe = /\[((?:[\s\S]*?))\]\s*TJ/g;
  while ((match = tjArrayRe.exec(content)) !== null) {
    const inner = match[1];
    const strRe = /\(((?:\\.|[^\\()])*)\)/g;
    let strMatch: RegExpExecArray | null;
    while ((strMatch = strRe.exec(inner)) !== null) {
      fragments.push(decodePdfString(strMatch[1]));
    }
  }
  return fragments.join(" ");
}

export interface PdfExtractionResult {
  pages: ExtractedPage[];
  budgetExceeded: boolean;
}

export function extractPdfPages(
  bytes: Uint8Array,
  budget: DecompressionBudget
): PdfExtractionResult {
  const raw = Buffer.from(bytes);
  const source = raw.toString("latin1");
  if (!source.startsWith("%PDF")) return { pages: [], budgetExceeded: false };

  const objects: Array<{ num: number; body: string }> = [];
  const objRe = /(\d+)\s+0\s+obj([\s\S]*?)endobj/g;
  let match: RegExpExecArray | null;
  while ((match = objRe.exec(source)) !== null) {
    objects.push({ num: Number(match[1]), body: match[2] });
  }

  const pages: ExtractedPage[] = [];
  const pageObjects = objects.filter((obj) => /\/Type\s*\/Page[\s/]/.test(obj.body));

  let budgetExceeded = false;
  pageObjects.forEach((pageObject, index) => {
    if (budgetExceeded) return;
    const contentsRef = pageObject.body.match(/\/Contents\s+(\d+)\s+0\s+R/);
    let text = "";
    if (contentsRef) {
      const contentObject = objects.find((o) => o.num === Number(contentsRef[1]));
      if (contentObject) {
        const result = streamContent(contentObject.body, budget);
        if (result.budgetExceeded) {
          budgetExceeded = true;
          return;
        }
        text = decodeTextOperators(result.text);
      }
    }
    if (text.trim()) pages.push({ page: index + 1, text: text.trim() });
  });

  // Fallback : même budget documentaire, jamais recréé ni redécompressé sans
  // limite. Il ne consomme que ce qui reste, donc le total du document reste
  // borné par MAX_DECOMPRESSED_BYTES.
  if (!budgetExceeded && pages.length === 0) {
    const fallbackParts: string[] = [];
    for (const obj of objects) {
      const result = streamContent(obj.body, budget);
      if (result.budgetExceeded) {
        budgetExceeded = true;
        break;
      }
      fallbackParts.push(result.text);
    }
    if (!budgetExceeded) {
      const fallback = decodeTextOperators(fallbackParts.join("\n"));
      if (fallback.trim()) pages.push({ page: 1, text: fallback.trim() });
    }
  }

  return { pages, budgetExceeded };
}
