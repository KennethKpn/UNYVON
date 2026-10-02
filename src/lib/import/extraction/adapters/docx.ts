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
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function documentXmlToText(xml: string): string {
  const paragraphs = xml.split("</w:p>");
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const runs = [...paragraph.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)];
    const line = runs.map((run) => xmlUnescape(run[1])).join("");
    if (line.trim()) lines.push(line);
  }
  return lines.join("\n");
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
