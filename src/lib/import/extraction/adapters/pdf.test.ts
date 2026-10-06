import { describe, expect, it } from "vitest";
import { createDecompressionBudget } from "../decompression";
import { extractPdfPages } from "./pdf";

function pdfFromObjects(objects: string[]): Uint8Array {
  return new TextEncoder().encode(
    ["%PDF-1.7", ...objects, "%%EOF"].join("\n")
  );
}

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

  const content = ["BT", "/F1 12 Tf", "[<01><02><03>] TJ", "ET"].join("\n");

  return pdfFromObjects([
    "1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj",
    "2 0 obj <</Type/Pages/Kids [3 0 R]/Count 1>> endobj",
    "3 0 obj <</Type/Page/Parent 2 0 R/Resources 4 0 R/Contents 5 0 R>> endobj",
    "4 0 obj <</Font 6 0 R>> endobj",
    "5 0 obj <</Length 42>> stream\n" + content + "\nendstream endobj",
    "6 0 obj <</F1 7 0 R>> endobj",
    "7 0 obj <</Type/Font/ToUnicode 8 0 R>> endobj",
    "8 0 obj <</Length " + cmap.length + ">> stream\n" + cmap + "\nendstream endobj",
  ]);
}

function outOfOrderPageTreePdf(): Uint8Array {
  return pdfFromObjects([
    "1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj",
    "10 0 obj <</Type/Page/Parent 2 0 R/Contents 30 0 R>> endobj",
    "30 0 obj <</Length 44>> stream\nBT (Deuxieme page) Tj ET\nendstream endobj",
    "20 0 obj <</Type/Page/Parent 2 0 R/Contents 31 0 R>> endobj",
    "31 0 obj <</Length 43>> stream\nBT (Premiere page) Tj ET\nendstream endobj",
    "2 0 obj <</Type/Pages/Kids [20 0 R 10 0 R]/Count 2>> endobj",
  ]);
}

function contentsArrayPdf(): Uint8Array {
  return pdfFromObjects([
    "1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj",
    "2 0 obj <</Type/Pages/Kids [3 0 R]/Count 1>> endobj",
    "3 0 obj <</Type/Page/Parent 2 0 R/Contents [4 0 R 5 0 R]>> endobj",
    "4 0 obj <</Length 31>> stream\nBT (Bloc A) Tj ET\nendstream endobj",
    "5 0 obj <</Length 31>> stream\nBT (Bloc B) Tj ET\nendstream endobj",
  ]);
}

function fallbackPaginationPdf(): Uint8Array {
  return pdfFromObjects([
    "10 0 obj <</Type/Page/Contents 11 0 R>> endobj",
    "11 0 obj <</Length 32>> stream\nBT (Sans arbre) Tj ET\nendstream endobj",
  ]);
}

describe("extractPdfPages", () => {
  it("lit les chaînes PDF hexadécimales via /ToUnicode", () => {
    const result = extractPdfPages(
      syntheticHexPdf(),
      createDecompressionBudget()
    );

    expect(result.budgetExceeded).toBe(false);
    expect(result.paginationVerified).toBe(true);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].text).toBe("ABC");
  });

  it("utilise l'arbre /Pages comme autorité de pagination plutôt que l'ordre des objets", () => {
    const result = extractPdfPages(
      outOfOrderPageTreePdf(),
      createDecompressionBudget()
    );

    expect(result.paginationVerified).toBe(true);
    expect(result.pages.map((page) => page.text)).toEqual([
      "Premiere page",
      "Deuxieme page",
    ]);
  });

  it("assemble les flux quand /Contents est un tableau de références", () => {
    const result = extractPdfPages(
      contentsArrayPdf(),
      createDecompressionBudget()
    );

    expect(result.paginationVerified).toBe(true);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].text).toBe("Bloc A Bloc B");
  });

  it("signale une pagination non vérifiée quand l'arbre /Pages est indisponible", () => {
    const result = extractPdfPages(
      fallbackPaginationPdf(),
      createDecompressionBudget()
    );

    expect(result.paginationVerified).toBe(false);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].text).toBe("Sans arbre");
  });
});
