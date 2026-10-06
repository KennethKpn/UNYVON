import type { DecompressionBudget } from "../decompression";

// ---------------------------------------------------------------------------
// Lecteur DOCX (ZIP) minimal sans dépendance : lit word/document.xml
// (méthodes 0 = store et 8 = deflate) et en extrait le texte des paragraphes.
// La décompression deflate passe par le budget documentaire partagé : une
// entrée dont la sortie dépasse le budget restant est bloquée.
// ---------------------------------------------------------------------------

interface EntryResult {
  data: Buffer | null;
  budgetExceeded: boolean;
}

function xmlUnescape(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_match, value: string) =>
      String.fromCodePoint(Number.parseInt(value, 16))
    )
    .replace(/&#([0-9]+);/g, (_match, value: string) =>
      String.fromCodePoint(Number.parseInt(value, 10))
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function inlineXmlToText(xml: string): string {
  const parts: string[] = [];
  const tokenRe =
    /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/\s*>|<w:br\b[^>]*\/\s*>|<w:cr\b[^>]*\/\s*>/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(xml)) !== null) {
    if (match[1] !== undefined) {
      parts.push(xmlUnescape(match[1]));
    } else if (match[0].startsWith("<w:tab")) {
      parts.push("\t");
    } else {
      parts.push("\n");
    }
  }

  return parts.join("");
}

function paragraphsXmlToText(xml: string): string {
  const paragraphs = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)];
  return paragraphs
    .map((match) => inlineXmlToText(match[0]).replace(/[ \t\r\n]+$/g, ""))
    .filter((line) => line.trim())
    .join("\n");
}

function tableXmlToText(xml: string): string {
  const rows = [...xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)];
  return rows
    .map((row) => {
      const cells = [...row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)];
      return cells
        .map((cell) =>
          paragraphsXmlToText(cell[0])
            .replace(/\r?\n/g, " / ")
            .trim()
        )
        .join("\t");
    })
    .filter((row) => row.trim())
    .join("\n");
}

function documentXmlToText(xml: string): string {
  // Les tableaux sont des blocs documentaires à part entière : leur
  // séparation cellule/ligne est conservée plutôt que de concaténer tous les
  // w:t comme une simple phrase. Cela permet à la structuration IA de voir les
  // colonnes et lignes d'un catalogue ou d'une facture.
  const blocks: string[] = [];
  const tableRe = /<w:tbl\b[\s\S]*?<\/w:tbl>/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tableRe.exec(xml)) !== null) {
    const before = paragraphsXmlToText(xml.slice(cursor, match.index));
    if (before) blocks.push(before);

    const table = tableXmlToText(match[0]);
    if (table) blocks.push(table);

    cursor = match.index + match[0].length;
  }

  const after = paragraphsXmlToText(xml.slice(cursor));
  if (after) blocks.push(after);

  return blocks.join("\n").trim();
}

function findEntry(
  buf: Buffer,
  name: string,
  budget: DecompressionBudget
): EntryResult {
  let eocdOffset = -1;
  const minOffset = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= minOffset; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return { data: null, budgetExceeded: false };

  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  let offset = buf.readUInt32LE(eocdOffset + 16);

  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const entryName = buf.toString("utf8", offset + 46, offset + 46 + nameLength);

    if (entryName === name) {
      if (localOffset + 30 > buf.length) return { data: null, budgetExceeded: false };
      const localNameLength = buf.readUInt16LE(localOffset + 26);
      const localExtraLength = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const data = buf.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return { data: Buffer.from(data), budgetExceeded: false };
      if (method === 8) {
        const outcome = budget.inflate(data, { raw: true });
        if (!outcome.ok) {
          return {
            data: null,
            budgetExceeded: outcome.reason === "DECOMPRESSION_BUDGET_EXCEEDED",
          };
        }
        return { data: outcome.data ?? null, budgetExceeded: false };
      }
      return { data: null, budgetExceeded: false };
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { data: null, budgetExceeded: false };
}

export interface DocxExtractionResult {
  text: string | null;
  budgetExceeded: boolean;
}

export function extractDocxText(
  bytes: Uint8Array,
  budget: DecompressionBudget
): DocxExtractionResult {
  const buf = Buffer.from(bytes);
  const entry = findEntry(buf, "word/document.xml", budget);
  if (entry.budgetExceeded) return { text: null, budgetExceeded: true };
  if (!entry.data) return { text: null, budgetExceeded: false };
  return { text: documentXmlToText(entry.data.toString("utf8")), budgetExceeded: false };
}
