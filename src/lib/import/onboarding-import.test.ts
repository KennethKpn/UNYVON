import { describe, expect, it } from "vitest";
import { buildOnboardingImportStock } from "./onboarding-import";
import type { DatabaseImportItem } from "./types";

const PRODUCT_A = "11111111-1111-4111-8111-111111111111";
const PRODUCT_B = "22222222-2222-4222-8222-222222222222";

function item(
  id: string,
  name: string,
  quantity: unknown,
  existingId: string | null = null
): DatabaseImportItem {
  return {
    id,
    session_id: "33333333-3333-4333-8333-333333333333",
    document_id: "44444444-4444-4444-8444-444444444444",
    organization_id: "55555555-5555-4555-8555-555555555555",
    entity_type: "product",
    source_page: 1,
    fields: {
      name: { raw: name, confidence: "high" },
      ...(quantity !== undefined
        ? {
            stock_quantity: {
              raw: String(quantity),
              normalized: quantity as number | string | null,
              confidence: "high",
            },
          }
        : {}),
    },
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