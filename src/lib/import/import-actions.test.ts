});



describe("extractionDiagnostics", () => {
  it("confirme une lecture locale même lorsque la structuration IA échoue", () => {
    const message = extractionDiagnostics({
      status: "PARTIAL",
      documentId: h.DOC,
      sourceKind: "pdf",
      source: "pdf",
      pages: [
        { page: 1, text: "Produits et clients" },
        { page: 2, text: "Ventes 45000 FCFA" },
      ],
      candidates: [],
      warnings: [],
      errors: [{ code: "PROVIDER_ERROR", message: "Gemini 503" }],
    });

    expect(message).toContain("Lecture locale réussie");
    expect(message).toContain("2 pages");
  });

  it("distingue un PDF sans texte local ayant basculé vers le fallback visuel", () => {
    const message = extractionDiagnostics({
      status: "FAILED",
      documentId: h.DOC,
      sourceKind: "pdf",
      source: "pdf-llm",