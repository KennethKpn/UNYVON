import { describe, expect, it } from "vitest";
import { resolveImportFileType } from "./file-selection";

describe("resolveImportFileType", () => {
  it("accepte un PNG quand le navigateur ne fournit aucun MIME", () => {
    expect(resolveImportFileType("catalogue.png", "")).toEqual({
      ok: true,
      sourceKind: "image",
      mimeType: "image/png",
    });
  });

  it("accepte un PNG quand le navigateur fournit le MIME alias image/x-png", () => {
    expect(resolveImportFileType("photo.PNG", "image/x-png")).toEqual({
      ok: true,
      sourceKind: "image",
      mimeType: "image/png",
    });
  });

  it("refuse un MIME réellement incompatible avec une alerte exploitable", () => {
    const result = resolveImportFileType("photo.png", "application/octet-stream");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Le fichier n a pas été envoyé");
  });
  it("refuse un MIME incompatible même si l'extension semble valide", () => {
    const result = resolveImportFileType("catalogue.png", "application/pdf");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("type MIME incompatible");
  });

  it("refuse explicitement un format non pris en charge", () => {
    const result = resolveImportFileType("catalogue.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("format non supporté");
  });

  it("résout un PDF avec son MIME déclaré", () => {
    expect(resolveImportFileType("catalogue.pdf", "application/pdf")).toEqual({
      ok: true,
      sourceKind: "pdf",
      mimeType: "application/pdf",
    });
  });
});
