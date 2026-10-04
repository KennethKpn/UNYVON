import { describe, expect, it } from "vitest";
import { buildOnboardingImportStock } from "./onboarding-import";
import type { DatabaseImportItem } from "./types";

const PRODUCT_A = "11111111-1111-4111-8111-111111111111";
const PRODUCT_B = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";
const ORG_ID = "55555555-5555-4555-8555-555555555555";

function item(
  id: string,
  name: string,
  quantity: unknown,
  existingId: string | null = null
): DatabaseImportItem {
  const fields: DatabaseImportItem["fields"] = {
    name: { raw: name, confidence: "high" },
  };
  if (quantity !== undefined) {
    fields.stock_quantity = {
      raw: String(quantity),
      normalized: quantity as number | string | null,
      confidence: "high",
    };
  }

  return {
    id,
    session_id: SESSION_ID,
    document_id: DOCUMENT_ID,
    organization_id: ORG_ID,
    entity_type: "product",
    source_page: 1,
    fields,
    match: existingId
      ? {
          existing_id: existingId,
          existing_name: name,
          score: 1,
          reason: "Nom exact",
        }
      : null,
    action: "create",
    status: "imported",
    error_message: null,
    created_at: "2026-10-04T00:00:00.000Z",
    updated_at: "2026-10-04T00:00:00.000Z",
  };
}

describe("buildOnboardingImportStock", () => {
  it("résout une cible exacte et retourne la quantité", () => {
    const result = buildOnboardingImportStock(
      [item("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Riz 25kg", 120, PRODUCT_A)],
      [{ id: PRODUCT_A, name: "Riz 25kg" }]
    );
    expect(result.stockByProductId).toEqual({ [PRODUCT_A]: 120 });
    expect(result.skippedItemIds).toEqual([]);
    expect(result.conflictItemIds).toEqual([]);
  });

  it("résout une création par nom normalisé après le commit", () => {
    const result = buildOnboardingImportStock(
      [item("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "HUILE  5L", 85)],
      [{ id: PRODUCT_B, name: "Huile 5L" }]
    );
    expect(result.stockByProductId).toEqual({ [PRODUCT_B]: 85 });
  });

  it("refuse une quantité décimale, négative ou non normalisée", () => {
    const result = buildOnboardingImportStock(
      [
        item("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "Riz", 12.5, PRODUCT_A),
        item("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "Huile", -2, PRODUCT_B),
        item("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "Mais", undefined, PRODUCT_A),
      ],
      [
        { id: PRODUCT_A, name: "Riz" },
        { id: PRODUCT_B, name: "Huile" },
      ]
    );
    expect(result.stockByProductId).toEqual({});
    expect(result.skippedItemIds).toHaveLength(3);
  });

  it("refuse une ambiguïté de nom", () => {
    const result = buildOnboardingImportStock(
      [item("ffffffff-ffff-4fff-8fff-ffffffffffff", "Riz", 50)],
      [
        { id: PRODUCT_A, name: "Riz" },
        { id: PRODUCT_B, name: "Riz" },
      ]
    );
    expect(result.stockByProductId).toEqual({});
    expect(result.skippedItemIds).toEqual(["ffffffff-ffff-4fff-8fff-ffffffffffff"]);
  });

  it("refuse un conflit de quantités pour le même produit", () => {
    const result = buildOnboardingImportStock(
      [
        item("10101010-1010-4101-8101-101010101010", "Riz", 50, PRODUCT_A),
        item("20202020-2020-4202-8202-202020202020", "Riz", 70, PRODUCT_A),
      ],
      [{ id: PRODUCT_A, name: "Riz" }]
    );
    expect(result.stockByProductId).toEqual({});
    expect(result.conflictItemIds).toEqual([
      "10101010-1010-4101-8101-101010101010",
      "20202020-2020-4202-8202-202020202020",
    ]);
  });
});
