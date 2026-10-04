      candidates: [
        {
          entityType: "product",
          fields: {
            name: { raw: "x", confidence: "high" },
            invented_field: { raw: "999", confidence: "high" },
          },
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("accepte product.stock_quantity comme donnée documentaire de stock initial", () => {
    const result = validateLlmOutput({
      candidates: [
        {
          entityType: "product",
          fields: {
            name: { raw: "x", confidence: "high" },
            stock_quantity: { raw: "42", normalized: 42, confidence: "high" },
          },
        },
      ],
    });
    expect(result.ok).toBe(true);
  });
});

describe("16. champ inconnu", () => {
  it("rejette un champ totalement inconnu (strict, zéro clé additionnelle)", () => {
    const result = validateLlmOutput({
      candidates: [
        {
          entityType: "customer",
          fields: {
            name: { raw: "Client", confidence: "high" },
            totally_unknown: { raw: "x", confidence: "high" },
          },
        },
      ],