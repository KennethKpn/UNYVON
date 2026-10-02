import { describe, expect, it } from "vitest";
import { prepareImportItemsForMaterialization } from "./materialization";
import type { ExtractedCandidate } from "./extraction/types";

const SESSION = "22222222-2222-4222-8222-222222222222";
const DOC = "33333333-3333-4333-8333-333333333333";
const OTHER_DOC = "44444444-4444-4444-8444-444444444444";

function candidate(
  overrides: Partial<ExtractedCandidate> = {}
): ExtractedCandidate {
  return {
    entityType: "product",
    fields: {
      name: {
        raw: "Riz parfumé",
        normalized: "Riz parfumé",
        confidence: "high",
        warning: null,
        page: 2,
      },
      sale_price: {
        raw: "18 500 FCFA",
        normalized: 18500,
        confidence: "high",
        warning: null,
        page: 2,
      },
    },
    documentId: DOC,
    page: 2,
    ...overrides,
  };
}

describe("prepareImportItemsForMaterialization", () => {
  it("produit un payload strictement minimal et DB-safe", () => {
    expect(
      prepareImportItemsForMaterialization([candidate()], SESSION, DOC)
    ).toEqual([
      {
        entity_type: "product",
        source_page: 2,
        fields: candidate().fields,
      },
    ]);
  });

  it("n'injecte jamais match/action/status/org dans le payload", () => {
    const result = prepareImportItemsForMaterialization(
      [candidate()],
      SESSION,
      DOC
    )[0];
    expect(result).not.toHaveProperty("match");
    expect(result).not.toHaveProperty("action");
    expect(result).not.toHaveProperty("status");
    expect(result).not.toHaveProperty("organization_id");
  });

  it("refuse un candidat provenant d'un autre document", () => {
    expect(() =>
      prepareImportItemsForMaterialization(
        [candidate({ documentId: OTHER_DOC })],
        SESSION,
        DOC
      )
    ).toThrow("documentId incohérent");
  });

  it("refuse un candidat sans name", () => {
    expect(() =>
      prepareImportItemsForMaterialization(
        [
          candidate({
            fields: {
              sale_price: {
                raw: "18 500",
                confidence: "high",
                warning: null,
                page: 2,
              },
            },
          }),
        ],
        SESSION,
        DOC
      )
    ).toThrow("name est obligatoire");
  });

  it("refuse un champ hors du contrat de l'entité", () => {
    expect(() =>
      prepareImportItemsForMaterialization(
        [
          candidate({
            entityType: "category",
            fields: {
              name: {
                raw: "Boissons",
                confidence: "high",
                warning: null,
                page: 1,
              },
              sale_price: {
                raw: "500",
                confidence: "high",
                warning: null,
                page: 1,
              },
            },
          }),
        ],
        SESSION,
        DOC
      )
    ).toThrow();
  });

  it("refuse plus de 500 candidats dans un document", () => {
    expect(() =>
      prepareImportItemsForMaterialization(
        Array.from({ length: 501 }, () => candidate()),
        SESSION,
        DOC
      )
    ).toThrow("maximum 500");
  });
});
