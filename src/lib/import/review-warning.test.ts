import { describe, expect, it } from "vitest";
import { collectImportReviewWarnings } from "./review-warning";
import type { DatabaseImportItem } from "./types";

function item(
  fields: DatabaseImportItem["fields"]
): Pick<DatabaseImportItem, "fields"> {
  return { fields };
}

describe("collectImportReviewWarnings", () => {
  it("remonte les warnings explicites sans doublon", () => {
    expect(
      collectImportReviewWarnings(
        item({
          name: { raw: "Savon", confidence: "low", warning: "Source visuelle non vérifiée" },
          sale_price: { raw: "1500", confidence: "low", warning: "Source visuelle non vérifiée" },
        })
      )
    ).toEqual(["Source visuelle non vérifiée"]);
  });

  it("signale une faible confiance même sans warning", () => {
    expect(
      collectImportReviewWarnings(
        item({
          name: { raw: "Savon", confidence: "low" },
        })
      )
    ).toEqual(["Confiance faible : vérification humaine recommandée."]);
  });

  it("ne signale rien pour des champs sans incertitude", () => {
    expect(
      collectImportReviewWarnings(
        item({
          name: { raw: "Savon", confidence: "high" },
          sale_price: { raw: "1500", confidence: "medium" },
        })
      )
    ).toEqual([]);
  });
});
