import { describe, expect, it } from "vitest";
import { createDecompressionBudget } from "../decompression";
import { extractPdfPages } from "./pdf";

function syntheticHexPdf(): Uint8Array {
  const cmap = [
    "begincmap",
    "1 begincodespacerange",
    "<00> <FF>",
    "endcodespacerange",
    "3 beginbfchar",
    "<01> <0041>",
    "<02> <0042>",
    "<03> <0043>",
    "endbfchar",
    "endcmap",
  ].join("\n");

  const content = [
    "BT",
    "/F1 12 Tf",
    "[<01><02><03>] TJ",
    "ET",
  ].join("\n");

  const pdf = [
    "%PDF-1.4",
    "1 0 obj",
    "<</Type /Page /Resources 2 0 R /Contents 3 0 R>>",
    "endobj",
    "2 0 obj",
    "<</Font 4 0 R>>",
    "endobj",
    "3 0 obj",
    `<</Length ${content.length}>>`,
    "stream",
    content,
    "endstream",
    "endobj",
    "4 0 obj",
    "<</F1 5 0 R>>",
    "endobj",
    "5 0 obj",
    "<</Type /Font /ToUnicode 6 0 R>>",
    "endobj",
    "6 0 obj",
    `<</Length ${cmap.length}>>`,
    "stream",
    cmap,
    "endstream",
    "endobj",
    "%%EOF",
  ].join("\n");

  return new TextEncoder().encode(pdf);
}

describe("extractPdfPages", () => {
  it("lit les chaînes PDF hexadécimales via /ToUnicode", () => {
    const result = extractPdfPages(
      syntheticHexPdf(),
      createDecompressionBudget()
    );

    expect(result.budgetExceeded).toBe(false);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].text).toBe("ABC");
  });
});
