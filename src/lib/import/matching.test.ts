import { describe, expect, it } from "vitest";
import { proposeImportItemMatch } from "./matching";

const existing = [
  { id: "a1", name: "Riz parfumé", phone: null, email: null },
  { id: "a2", name: "Riz parfumé", phone: null, email: null },
];

function candidate(
  entityType: "category" | "product" | "customer" | "supplier",
  fields: Record<string, { raw: string; normalized?: string | number | null }>
) {
  return { entityType, fields };
}

describe("proposeImportItemMatch", () => {
  it("propose un nom exact unique sans auto-décision", () => {
    expect(
      proposeImportItemMatch(
        candidate("product", { name: { raw: " Riz   parfumé " } }),
        [{ id: "a1", name: "Riz parfumé" }]
      )
    ).toEqual({
      existing_id: "a1",
      existing_name: "Riz parfumé",
      score: 0.9,
      reason: "Nom exact",
    });
  });

  it("normalise casse, accents et ponctuation", () => {
    expect(
      proposeImportItemMatch(
        candidate("category", { name: { raw: "Boissons-énergétiques" } }),
        [{ id: "a1", name: "Boissons énergétiques" }]
      ).existing_id
    ).toBe("a1");
  });

  it("refuse de choisir parmi deux noms identiques", () => {
    expect(
      proposeImportItemMatch(
        candidate("product", { name: { raw: "Riz parfumé" } }),
        existing
      )
    ).toMatchObject({
      existing_id: null,
      score: 0,
    });
  });

  it("lève l'ambiguïté client grâce au téléphone exact", () => {
    expect(
      proposeImportItemMatch(
        candidate("customer", {
          name: { raw: "ACME" },
          phone: { raw: "+229 97 12 34 56" },
        }),
        [
          { id: "a1", name: "ACME", phone: "+22997123456" },
          { id: "a2", name: "ACME", phone: "+22990112233" },
        ]
      )
    ).toMatchObject({
      existing_id: "a1",
      score: 1,
    });
  });

  it("peut retrouver un client par téléphone seul", () => {
    expect(
      proposeImportItemMatch(
        candidate("customer", {
          name: { raw: "Nom nouveau" },
          phone: { raw: "97 12 34 56" },
        }),
        [{ id: "a1", name: "Ancien nom", phone: "97123456" }]
      )
    ).toMatchObject({
      existing_id: "a1",
      score: 0.95,
    });
  });

  it("ne fait jamais de rapprochement fuzzy par simple similarité", () => {
    expect(
      proposeImportItemMatch(
        candidate("product", { name: { raw: "Riz parfum" } }),
        [{ id: "a1", name: "Riz parfumé" }]
      ).existing_id
    ).toBeNull();
  });

  it("refuse un contact partagé entre plusieurs clients", () => {
    expect(
      proposeImportItemMatch(
        candidate("customer", {
          name: { raw: "Nom nouveau" },
          email: { raw: "contact@acme.test" },
        }),
        [
          { id: "a1", name: "A", email: "contact@acme.test" },
          { id: "a2", name: "B", email: "CONTACT@ACME.TEST" },
        ]
      ).existing_id
    ).toBeNull();
  });
});
