import { inflateSync } from "node:zlib";
import type { ExtractedPage } from "../types";

// ---------------------------------------------------------------------------
// Extracteur PDF minimal (sans dépendance) : conserve la pagination réelle
// via les objets /Type /Page et leurs flux /Contents (FlateDecode supporté).
// ---------------------------------------------------------------------------

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

function streamContent(objectBody: string): string {
  const match = objectBody.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
  if (!match) return "";
  let data = Buffer.from(match[1], "latin1");
  if (/\/Filter\s*\/FlateDecode/.test(objectBody.slice(0, match.index ?? 0))) {
    try {
      data = inflateSync(data);
    } catch {
      return "";
    }
  }
  return data.toString("latin1");
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

export function extractPdfPages(bytes: Uint8Array): ExtractedPage[] {
  const raw = Buffer.from(bytes);
  const source = raw.toString("latin1");
  if (!source.startsWith("%PDF")) return [];

  const objects: Array<{ num: number; body: string }> = [];
  const objRe = /(\d+)\s+0\s+obj([\s\S]*?)endobj/g;
  let match: RegExpExecArray | null;
  while ((match = objRe.exec(source)) !== null) {
    objects.push({ num: Number(match[1]), body: match[2] });
  }

  const pages: ExtractedPage[] = [];
  const pageObjects = objects.filter((obj) => /\/Type\s*\/Page[\s/]/.test(obj.body));

  pageObjects.forEach((pageObject, index) => {
    const contentsRef = pageObject.body.match(/\/Contents\s+(\d+)\s+0\s+R/);
    let text = "";
    if (contentsRef) {
      const contentObject = objects.find((o) => o.num === Number(contentsRef[1]));
      if (contentObject) text = decodeTextOperators(streamContent(contentObject.body));
    }
    if (text.trim()) pages.push({ page: index + 1, text: text.trim() });
  });

  if (pages.length === 0) {
    const fallback = decodeTextOperators(
      objects.map((o) => streamContent(o.body)).join("\n")
    );
    if (fallback.trim()) pages.push({ page: 1, text: fallback.trim() });
  }

  return pages;
}
