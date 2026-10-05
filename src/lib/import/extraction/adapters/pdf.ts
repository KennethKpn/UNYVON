import type { DecompressionBudget } from "../decompression";
import type { ExtractedPage } from "../types";

// ---------------------------------------------------------------------------
// Extracteur PDF sans dépendance lourde.
//
// Certains PDF issus de Word/LibreOffice n'utilisent pas "(...)" pour le
// texte : ils emploient des chaînes hexadécimales "<01><02>..." et une table
// /ToUnicode. Ce lecteur gère les formes littérales et hexadécimales, avec
// support des mappings bfchar/bfrange usuels.
// ---------------------------------------------------------------------------

interface StreamResult {
  text: string;
  budgetExceeded: boolean;
}

interface PdfObject {
  num: number;
  body: string;
}

type ToUnicodeMap = Map<string, string>;
type FontMap = Map<string, ToUnicodeMap>;

function decodePdfString(raw: string): string {
  return raw.replace(/\\([nrtbf()\\]|(\\d{1,3}))/g, (_match, esc: string) => {
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

function decodeUnicodeHex(hex: string): string {
  const cleaned = hex.replace(/[^0-9a-f]/gi, "");
  if (!cleaned) return "";
  const units: number[] = [];
  for (let i = 0; i + 3 < cleaned.length; i += 4) {
    units.push(Number.parseInt(cleaned.slice(i, i + 4), 16));
  }
  return String.fromCharCode(...units);
}

function normalizeHexToken(hex: string): string {
  return hex.replace(/[^0-9a-f]/gi, "").toUpperCase();
}

function parseToUnicodeMap(cmap: string): ToUnicodeMap {
  const map: ToUnicodeMap = new Map();

  const bfcharBlock = /beginbfchar\s+([\s\S]*?)\s+endbfchar/g;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = bfcharBlock.exec(cmap)) !== null) {
    const lineRe = /<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/g;
    let line: RegExpExecArray | null;
    while ((line = lineRe.exec(blockMatch[1])) !== null) {
      map.set(normalizeHexToken(line[1]), decodeUnicodeHex(line[2]));
    }
  }

  const bfrangeBlock = /beginbfrange\s+([\s\S]*?)\s+endbfrange/g;
  while ((blockMatch = bfrangeBlock.exec(cmap)) !== null) {
    const lineRe = /<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>\s+(<([0-9A-Fa-f]+)>|\[[\s\S]*?\])/g;
    let line: RegExpExecArray | null;
    while ((line = lineRe.exec(blockMatch[1])) !== null) {
      const start = Number.parseInt(line[1], 16);
      const end = Number.parseInt(line[2], 16);
      const width = line[1].length;

      if (line[3].startsWith("[")) {
        const values = [...line[3].matchAll(/<([0-9A-Fa-f]+)>/g)];
        for (let offset = 0; offset <= end - start && offset < values.length; offset += 1) {
          map.set(
            (start + offset).toString(16).padStart(width, "0").toUpperCase(),
            decodeUnicodeHex(values[offset][1])
          );
        }
      } else {
        const base = Number.parseInt(line[4], 16);
        const destinationWidth = line[4].length;
        for (let code = start; code <= end; code += 1) {
          map.set(
            code.toString(16).padStart(width, "0").toUpperCase(),
            decodeUnicodeHex(
              (base + code - start).toString(16).padStart(destinationWidth, "0")
            )
          );
        }
      }
    }
  }

  return map;
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
    return {
      text: outcome.data?.toString("latin1") ?? "",
      budgetExceeded: false,
    };
  }

  return { text: data.toString("latin1"), budgetExceeded: false };
}

function objectRef(body: string, key: string): number | null {
  const match = body.match(new RegExp("/" + key + "\\s+(\\d+)\\s+0\\s+R"));
  return match ? Number(match[1]) : null;
}

function buildFontMaps(
  pageObject: PdfObject,
  objectsByNum: Map<number, PdfObject>,
  budget: DecompressionBudget,
  cmapCache: Map<number, ToUnicodeMap | null>,
): FontMap {
  const resourcesRef = objectRef(pageObject.body, "Resources");
  if (resourcesRef === null) return new Map();

  const resources = objectsByNum.get(resourcesRef);
  if (!resources) return new Map();

  const fontRef = objectRef(resources.body, "Font");
  if (fontRef === null) return new Map();

  const fontDictionary = objectsByNum.get(fontRef);
  if (!fontDictionary) return new Map();

  const fonts: FontMap = new Map();
  const fontEntryRe = /\/(F[A-Za-z0-9_.-]+)\s+(\d+)\s+0\s+R/g;
  let match: RegExpExecArray | null;

  while ((match = fontEntryRe.exec(fontDictionary.body)) !== null) {
    const fontObject = objectsByNum.get(Number(match[2]));
    if (!fontObject) continue;

    const toUnicodeRef = objectRef(fontObject.body, "ToUnicode");
    if (toUnicodeRef === null) continue;

    let parsed = cmapCache.get(toUnicodeRef);
    if (parsed === undefined) {
      const cmapObject = objectsByNum.get(toUnicodeRef);
      if (!cmapObject) {
        cmapCache.set(toUnicodeRef, null);
        continue;
      }

      const cmap = streamContent(cmapObject.body, budget);
      if (cmap.budgetExceeded) continue;

      parsed = parseToUnicodeMap(cmap.text);
      cmapCache.set(toUnicodeRef, parsed);
    }

    if (parsed && parsed.size > 0) {
      fonts.set(match[1], parsed);
    }
  }

  return fonts;
}

function decodeHexString(
  hex: string,
  fonts: FontMap,
  fontName: string | null
): string {
  const cleaned = normalizeHexToken(hex);
  if (!cleaned) return "";

  const map = fontName ? fonts.get(fontName) : undefined;
  if (!map || map.size === 0) {
    return Buffer.from(cleaned, "hex").toString("latin1");
  }

  const codeWidth = Math.max(
    2,
    Math.min(...[...map.keys()].map((key) => key.length))
  );

  const fragments: string[] = [];
  for (
    let offset = 0;
    offset + codeWidth <= cleaned.length;
    offset += codeWidth
  ) {
    const code = cleaned.slice(offset, offset + codeWidth).toUpperCase();
    fragments.push(
      map.get(code) ?? String.fromCharCode(Number.parseInt(code, 16))
    );
  }

  return fragments.join("");
}

function currentFontBefore(content: string, position: number): string | null {
  const prefix = content.slice(0, position);
  const fontRe = /\/(F[A-Za-z0-9_.-]+)\s+[-+0-9.]+\s+Tf/g;
  let match: RegExpExecArray | null = null;
  let current: RegExpExecArray | null;

  while ((current = fontRe.exec(prefix)) !== null) {
    match = current;
  }

  return match?.[1] ?? null;
}

function decodeTextOperators(content: string, fonts: FontMap): string {
  const fragments: string[] = [];

  const directRe = /(\((?:\\.|[^\\()])*\)|<([0-9A-Fa-f\s]+)>)\s*Tj/g;
  let direct: RegExpExecArray | null;
  while ((direct = directRe.exec(content)) !== null) {
    const token = direct[1];
    const font = currentFontBefore(content, direct.index);

    fragments.push(
      token.startsWith("(")
        ? decodePdfString(token.slice(1, -1))
        : decodeHexString(token.slice(1, -1), fonts, font)
    );
  }

  const arrayRe = /\[([\s\S]*?)\]\s*TJ/g;
  let array: RegExpExecArray | null;
  while ((array = arrayRe.exec(content)) !== null) {
    const font = currentFontBefore(content, array.index);
    const inner = array[1];
    const tokenRe = /\((?:\\.|[^\\()])*\)|<([0-9A-Fa-f\s]+)>/g;
    let token: RegExpExecArray | null;
    let operatorText = "";

    while ((token = tokenRe.exec(inner)) !== null) {
      const rawToken = token[0];
      operatorText += rawToken.startsWith("(")
        ? decodePdfString(rawToken.slice(1, -1))
        : decodeHexString(rawToken.slice(1, -1), fonts, font);
    }

    if (operatorText) fragments.push(operatorText);
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

  if (!source.startsWith("%PDF")) {
    return { pages: [], budgetExceeded: false };
  }

  const objects: PdfObject[] = [];
  const objectsByNum = new Map<number, PdfObject>();
  const objRe = /(\d+)\s+0\s+obj([\s\S]*?)endobj/g;
  let match: RegExpExecArray | null;

  while ((match = objRe.exec(source)) !== null) {
    const object = { num: Number(match[1]), body: match[2] };
    objects.push(object);
    objectsByNum.set(object.num, object);
  }

  const pageObjects = objects.filter((obj) =>
    /\/Type\s*\/Page[\s/]/.test(obj.body)
  );
  const pages: ExtractedPage[] = [];
  const cmapCache = new Map<number, ToUnicodeMap | null>();

  let budgetExceeded = false;

  pageObjects.forEach((pageObject, index) => {
    if (budgetExceeded) return;

    const contentsRef = objectRef(pageObject.body, "Contents");
    let text = "";

    if (contentsRef !== null) {
      const contentObject = objectsByNum.get(contentsRef);
      if (contentObject) {
        const result = streamContent(contentObject.body, budget);
        if (result.budgetExceeded) {
          budgetExceeded = true;
          return;
        }

        const fonts = buildFontMaps(
          pageObject,
          objectsByNum,
          budget,
          cmapCache
        );
        text = decodeTextOperators(result.text, fonts);
      }
    }

    if (text.trim()) {
      pages.push({ page: index + 1, text: text.trim() });
    }
  });

  // Fallback de compatibilité pour les PDF atypiques sans contenu rattaché à
  // /Type /Page. Toujours borné par le budget de décompression.
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
      const fallback = decodeTextOperators(
        fallbackParts.join("\n"),
        new Map()
      );
      if (fallback.trim()) {
        pages.push({ page: 1, text: fallback.trim() });
      }
    }
  }

  return { pages, budgetExceeded };
}
