import type { DecompressionBudget } from "../decompression";

interface EntryResult {
  data: Buffer | null;
  budgetExceeded: boolean;
}

interface NamedEntryResult extends EntryResult {
  name: string;
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

function xmlPartToText(xml: string): string {
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

function readZipEntryAt(
  buf: Buffer,
  localOffset: number,
  method: number,
  compressedSize: number,
  budget: DecompressionBudget
): EntryResult {
  if (
    localOffset < 0 ||
    compressedSize < 0 ||
    localOffset + 30 > buf.length
  ) {
    return { data: null, budgetExceeded: false };
  }

  const localNameLength = buf.readUInt16LE(localOffset + 26);
  const localExtraLength = buf.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + localNameLength + localExtraLength;
  const dataEnd = dataStart + compressedSize;
  if (dataStart < 0 || dataEnd > buf.length) {
    return { data: null, budgetExceeded: false };
  }

  const data = buf.subarray(dataStart, dataEnd);
  if (method === 0) {
    return { data: Buffer.from(data), budgetExceeded: false };
  }
  if (method !== 8) {
    return { data: null, budgetExceeded: false };
  }

  const outcome = budget.inflate(data, { raw: true });
  if (!outcome.ok) {
    return {
      data: null,
      budgetExceeded: outcome.reason === "DECOMPRESSION_BUDGET_EXCEEDED",
    };
  }

  return { data: outcome.data ?? null, budgetExceeded: false };
}

interface ZipEntryMeta {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

function listZipEntries(buf: Buffer): ZipEntryMeta[] {
  let eocdOffset = -1;
  const minOffset = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= minOffset; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return [];

  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  let offset = buf.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntryMeta[] = [];

  for (let i = 0; i < entryCount; i += 1) {
    if (
      offset + 46 > buf.length ||
      buf.readUInt32LE(offset) !== 0x02014b50
    ) {
      break;
    }

    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);

    entries.push({
      name: buf.toString(
        "utf8",
        offset + 46,
        offset + 46 + nameLength
      ),
      method: buf.readUInt16LE(offset + 10),
      compressedSize: buf.readUInt32LE(offset + 20),
      localOffset: buf.readUInt32LE(offset + 42),
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function documentXmlToText(xml: string): string {
  return xmlPartToText(xml);
}

function auxiliaryPartLabel(name: string): string {
  const file = name.slice(name.lastIndexOf("/") + 1);
  const base = file.replace(/\.xml$/i, "");
  if (/^header\d+$/i.test(base)) return "HEADER";
  if (/^footer\d+$/i.test(base)) return "FOOTER";
  if (/^footnotes$/i.test(base)) return "FOOTNOTES";
  if (/^endnotes$/i.test(base)) return "ENDNOTES";
  return "AUXILIARY";
}

export interface DocxExtractionResult {
  text: string | null;
  budgetExceeded: boolean;
}

export function extractDocxText(
  bytes: Uint8Array,
  budget: DecompressionBudget
): DocxExtractionResult {  const buf = Buffer.from(bytes);
  const entries = listZipEntries(buf);
  const targetNames = new Set(
    entries
      .filter(
        (entry) =>
          entry.name === "word/document.xml" ||
          /^(?:word\/header\d+|word\/footer\d+|word\/footnotes|word\/endnotes)\.xml$/i.test(
            entry.name
          )
      )
      .map((entry) => entry.name)
  );

  const decoded = new Map<string, Buffer>();
  let budgetExceeded = false;

  for (const entry of entries) {
    if (!targetNames.has(entry.name)) continue;

    const result = readZipEntryAt(
      buf,
      entry.localOffset,
      entry.method,
      entry.compressedSize,
      budget
    );

    if (result.budgetExceeded) {
      budgetExceeded = true;
      break;
    }

    if (result.data) {
      decoded.set(entry.name, result.data);
    }
  }

  const documentXml = decoded.get("word/document.xml");
  if (budgetExceeded || !documentXml) {
    return { text: null, budgetExceeded };
  }

  const sections: string[] = [];
  const bodyText = documentXmlToText(documentXml.toString("utf8"));
  if (bodyText) sections.push(bodyText);

  const auxiliary = entries
    .filter((entry) => decoded.has(entry.name))
    .filter(
      (entry) =>
        /^(?:word\/header\d+|word\/footer\d+|word\/footnotes|word\/endnotes)\.xml$/i.test(
          entry.name
        )
    )
    .map((entry) => {
      const data = decoded.get(entry.name);
      if (!data) return "";
      const text = xmlPartToText(data.toString("utf8"));
      if (!text) return "";
      return "[" + auxiliaryPartLabel(entry.name) + "]\n" + text;
    })
    .filter(Boolean);

  if (auxiliary.length > 0) {
    sections.push(auxiliary.join("\n\n"));
  }

  const text = sections.join("\n\n").trim();
  return {
    text: text || null,
    budgetExceeded: false,
  };
}