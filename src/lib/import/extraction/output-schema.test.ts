import { describe, expect, it } from "vitest";
import { llmExtractionOutputSchema, validateLlmOutput } from "./output-schema";
import type { ExtractedCandidate } from "./types";

// ---------------------------------------------------------------------------
// 13-17. Validation stricte de la sortie LLM — jamais de confiance aveugle
// ---------------------------------------------------------------------------

const VALID = {
  candidates: [
    {
      entityType: "product",
      fields: {
        name: { raw: "Savon noir 200g", confidence: "high", page: 1 },
        sale_price: { raw: "1500", confidence: "medium", page: 1 },
      },
    },
  ],
};

function expectValid(output: unknown): ExtractedCandidate[] {
  const result = validateLlmOutput(output);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected ok");
  return result.candidates;
}

describe("13. JSON modèle valide", () => {
  it("accepte une sortie conforme au modèle Phase 2", () => {
    const candidates = expectValid(VALID);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].entityType).toBe("product");
    expect(candidates[0].fields.name?.raw).toBe("Savon noir 200g");
    expect(candidates[0].fields.sale_price?.confidence).toBe("medium");
  });

  it("accepte les 4 entityType du modèle Phase 2", () => {
    for (const entityType of ["category", "product", "customer", "supplier"]) {
      const candidates = expectValid({
        candidates: [
          { entityType, fields: { name: { raw: "Test", confidence: "high" } } },
        ],
      });
      expect(candidates[0].entityType).toBe(entityType);
    }
  });
});

describe("14. JSON modèle invalide", () => {
  it("rejette un JSON non structuré en candidats", () => {
    const result = validateLlmOutput({ candidates: "pas-un-tableau" });
    expect(result.ok).toBe(false);
  });

  it("rejette un candidat sans entityType", () => {
    const result = validateLlmOutput({ candidates: [{ fields: { name: { raw: "x", confidence: "high" } } }] });
    expect(result.ok).toBe(false);
  });

  it("rejette une confiance hors de l'enum SQL", () => {
    const result = validateLlmOutput({
      candidates: [
        { entityType: "product", fields: { name: { raw: "x", confidence: "certain" } } },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("rejette un raw manquant (valeur absente = champ absent, pas de placeholder)", () => {
    const result = validateLlmOutput({
      candidates: [{ entityType: "product", fields: { name: { confidence: "high" } } }],
    });
    expect(result.ok).toBe(false);
  });
});

describe("15. sortie LLM inventant un champ interdit", () => {
  it("rejette un champ hors IMPORT_TARGET_FIELDS (invention de prix...)", () => {
    const result = validateLlmOutput({
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

  it("rejette product.stock_quantity : les champs V1 sont strictement listés", () => {
    const result = validateLlmOutput({
      candidates: [
        {
          entityType: "product",
          fields: {
            name: { raw: "x", confidence: "high" },
            stock_quantity: { raw: "42", confidence: "high" },
          },
        },
      ],
    });
    expect(result.ok).toBe(false);
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
    });
    expect(result.ok).toBe(false);
  });
});

describe("17. entityType inconnu", () => {
  it("rejette un entityType hors du modèle Phase 2", () => {
    const result = validateLlmOutput({
      candidates: [
        { entityType: "invoice", fields: { name: { raw: "x", confidence: "high" } } },
      ],
    });
    expect(result.ok).toBe(false);
  });
});

describe("champ name obligatoire (règle Phase 2)", () => {
  it("rejette un candidat product sans name", () => {
    const result = validateLlmOutput({
      candidates: [
        { entityType: "product", fields: { price: { raw: "100", confidence: "high" } } },
      ],
    });
    expect(result.ok).toBe(false);
  });
});

describe("schéma exporté", () => {
  it("llmExtractionOutputSchema est un schéma zod strict utilisable directement", () => {
    expect(llmExtractionOutputSchema.safeParse(VALID).success).toBe(true);
    expect(llmExtractionOutputSchema.safeParse({ candidates: [] }).success).toBe(true);
    expect(llmExtractionOutputSchema.safeParse({}).success).toBe(false);
  });
});
