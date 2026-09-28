import { describe, expect, it } from "vitest";
import {
  addImportDocumentSchema,
  buildImportStoragePath,
  canTransitionImportDocument,
  canTransitionImportItemStatus,
  canTransitionImportSession,
  createImportSessionSchema,
  importFieldProvenanceSchema,
  importItemInputSchema,
  importItemMatchSchema,
  importStoragePathSchema,
  updateImportItemSchema,
} from "./schemas";
import {
  IMPORT_DOCUMENT_STATES,
  IMPORT_ENTITY_TYPES,
  IMPORT_FIELD_CONFIDENCES,
  IMPORT_ITEM_ACTIONS,
  IMPORT_ITEM_STATUSES,
  IMPORT_SESSION_STATES,
  IMPORT_SOURCE_KINDS,
  IMPORT_TARGET_FIELDS,
} from "./types";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_ID = "33333333-3333-4333-8333-333333333333";
const EXISTING_ID = "44444444-4444-4444-8444-444444444444";

describe("enums alignés sur les types SQL (0011_import.sql)", () => {
  it("import_session_state", () => {
    expect([...IMPORT_SESSION_STATES]).toEqual([
      "collecting",
      "processing",
      "needs_review",
      "ready",
      "importing",
      "completed",
      "failed",
      "cancelled",
    ]);
  });

  it("import_document_state", () => {
    expect([...IMPORT_DOCUMENT_STATES]).toEqual([
      "uploading",
      "uploaded",
      "parsing",
      "parsed",
      "extracting",
      "extracted",
      "failed",
    ]);
  });

  it("import_entity_type", () => {
    expect([...IMPORT_ENTITY_TYPES]).toEqual([
      "category",
      "product",
      "customer",
      "supplier",
    ]);
  });

  it("import_item_action", () => {
    expect([...IMPORT_ITEM_ACTIONS]).toEqual([
      "create",
      "use_existing",
      "update",
      "ignore",
    ]);
  });

  it("import_item_status", () => {
    expect([...IMPORT_ITEM_STATUSES]).toEqual([
      "pending",
      "validated",
      "ignored",
      "imported",
      "failed",
    ]);
  });

  it("source_kind et confidence", () => {
    expect([...IMPORT_SOURCE_KINDS]).toEqual([
      "pdf",
      "docx",
      "doc",
      "md",
      "image",
    ]);
    expect([...IMPORT_FIELD_CONFIDENCES]).toEqual([
      "high",
      "medium",
      "low",
      "missing",
    ]);
  });

  it("IMPORT_TARGET_FIELDS couvre exactement les entity types", () => {
    expect(Object.keys(IMPORT_TARGET_FIELDS).sort()).toEqual(
      [...IMPORT_ENTITY_TYPES].sort()
    );
  });
});

describe("importFieldProvenanceSchema", () => {
  it("accepte l'exemple de provenance de la migration", () => {
    const value = {
      raw: "18 500 F",
      normalized: 18500,
      confidence: "high",
      warning: null,
      page: 3,
    };
    expect(importFieldProvenanceSchema.parse(value)).toEqual(value);
  });

  it("accepte confidence 'missing' avec warning", () => {
    const value = { raw: "", confidence: "missing", warning: "Absent du document" };
    expect(importFieldProvenanceSchema.parse(value)).toEqual(value);
  });

  it("rejette une confidence inconnue", () => {
    expect(() =>
      importFieldProvenanceSchema.parse({
        raw: "x",
        confidence: "sure",
      })
    ).toThrow();
  });

  it("rejette une page hors limites", () => {
    expect(() =>
      importFieldProvenanceSchema.parse({
        raw: "x",
        confidence: "high",
        page: 0,
      })
    ).toThrow();
  });

  it("rejette les clés inconnues (objet strict)", () => {
    expect(() =>
      importFieldProvenanceSchema.parse({
        raw: "x",
        confidence: "high",
        invented: true,
      })
    ).toThrow();
  });
});

describe("importItemMatchSchema", () => {
  it("accepte un score de rapprochement plausible", () => {
    const value = {
      existing_id: EXISTING_ID,
      existing_name: "Riz local",
      score: 0.92,
      reason: "Nom quasi identique",
    };
    expect(importItemMatchSchema.parse(value)).toEqual(value);
  });

  it("accepte existing_id null (aucune correspondance)", () => {
    expect(
      importItemMatchSchema.parse({
        existing_id: null,
        existing_name: null,
        score: 0,
      })
    ).toEqual({ existing_id: null, existing_name: null, score: 0 });
  });

  it("rejette un score hors [0, 1]", () => {
    expect(() =>
      importItemMatchSchema.parse({
        existing_id: null,
        existing_name: null,
        score: 1.5,
      })
    ).toThrow();
  });
});

describe("createImportSessionSchema", () => {
  it("accepte un organization_id valide", () => {
    expect(createImportSessionSchema.parse({ organizationId: ORG_ID })).toEqual({
      organizationId: ORG_ID,
    });
  });

  it("rejette un uuid invalide", () => {
    expect(() =>
      createImportSessionSchema.parse({ organizationId: "pas-un-uuid" })
    ).toThrow();
  });
});

describe("addImportDocumentSchema", () => {
  const valid = {
    sessionId: SESSION_ID,
    originalName: "stock-2026.pdf",
    sourceKind: "pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
  };

  it("accepte un document dans les limites", () => {
    expect(addImportDocumentSchema.parse(valid)).toEqual(valid);
  });

  it("rejette un fichier au-delà de 25 Mo", () => {
    expect(() =>
      addImportDocumentSchema.parse({ ...valid, sizeBytes: 25 * 1024 * 1024 + 1 })
    ).toThrow();
  });

  it("rejette un size_bytes non entier ou nul", () => {
    expect(() => addImportDocumentSchema.parse({ ...valid, sizeBytes: 0 })).toThrow();
    expect(() =>
      addImportDocumentSchema.parse({ ...valid, sizeBytes: 10.5 })
    ).toThrow();
  });

  it("rejette un source_kind hors de la liste SQL", () => {
    expect(() =>
      addImportDocumentSchema.parse({ ...valid, sourceKind: "xlsx" })
    ).toThrow();
  });

  it("rejette un nom de fichier vide", () => {
    expect(() =>
      addImportDocumentSchema.parse({ ...valid, originalName: "   " })
    ).toThrow();
  });
});

describe("importItemInputSchema", () => {
  const base = { sessionId: SESSION_ID, documentId: DOCUMENT_ID };

  it("accepte un produit avec champs valides", () => {
    const value = {
      ...base,
      entityType: "product",
      sourcePage: 2,
      fields: {
        name: { raw: "Riz 25kg", confidence: "high" },
        sale_price: { raw: "18 500 F", normalized: 18500, confidence: "high" },
        category: { raw: "Céréales", confidence: "medium", warning: null },
      },
    };
    expect(importItemInputSchema.parse(value)).toEqual(value);
  });

  it("accepte les colonnes DB d'un fournisseur", () => {
    const value = {
      ...base,
      entityType: "supplier",
      fields: {
        name: { raw: "Ets Kaba", confidence: "high" },
        phone: { raw: "+229 95 00 11 22", confidence: "high" },
        address: { raw: "Cotonou, Haie Vive", confidence: "medium" },
      },
    };
    expect(importItemInputSchema.parse(value)).toEqual(value);
  });

  it("rejette supplier.products (aucune colonne cible en 0003)", () => {
    expect(() =>
      importItemInputSchema.parse({
        ...base,
        entityType: "supplier",
        fields: {
          name: { raw: "Ets Kaba", confidence: "high" },
          products: { raw: "Riz, Huile", confidence: "medium" },
        },
      })
    ).toThrow();
  });

  it("rejette un champ hors allowlist (jamais d'invention)", () => {
    expect(() =>
      importItemInputSchema.parse({
        ...base,
        entityType: "product",
        fields: {
          name: { raw: "Riz 25kg", confidence: "high" },
          stock_quantity: { raw: "40", normalized: 40, confidence: "high" },
        },
      })
    ).toThrow();
  });

  it("rejette un item sans champ name", () => {
    expect(() =>
      importItemInputSchema.parse({
        ...base,
        entityType: "product",
        fields: {
          unit: { raw: "sac", confidence: "high" },
        },
      })
    ).toThrow();
    expect(() =>
      importItemInputSchema.parse({
        ...base,
        entityType: "category",
        fields: {
          name: { raw: "", confidence: "missing" },
        },
      })
    ).not.toThrow();
  });

  it("rejette les champs d'une autre entité (union discriminée)", () => {
    expect(() =>
      importItemInputSchema.parse({
        ...base,
        entityType: "product",
        fields: {
          name: { raw: "Riz", confidence: "high" },
          address: { raw: "Cotonou", confidence: "high" },
        },
      })
    ).toThrow();
  });

  it("rejette une source_page hors limites", () => {
    expect(() =>
      importItemInputSchema.parse({
        ...base,
        entityType: "category",
        sourcePage: 0,
        fields: { name: { raw: "Céréales", confidence: "high" } },
      })
    ).toThrow();
  });

  it("accepte une proposition de rapprochement jointe", () => {
    const value = {
      ...base,
      entityType: "customer",
      fields: { name: { raw: "Jean Boko", confidence: "high" } },
      match: {
        existing_id: EXISTING_ID,
        existing_name: "Jean Boko",
        score: 0.87,
        reason: "Téléphone identique",
      },
    };
    expect(importItemInputSchema.parse(value)).toEqual(value);
  });
});

describe("updateImportItemSchema", () => {
  it("accepte une mise à jour de statut", () => {
    expect(updateImportItemSchema.parse({ id: EXISTING_ID, status: "validated" })).toEqual({
      id: EXISTING_ID,
      status: "validated",
    });
  });

  it("accepte une mise à jour d'action", () => {
    expect(updateImportItemSchema.parse({ id: EXISTING_ID, action: "ignore" })).toEqual({
      id: EXISTING_ID,
      action: "ignore",
    });
  });

  it("rejette une mise à jour vide", () => {
    expect(() => updateImportItemSchema.parse({ id: EXISTING_ID })).toThrow();
  });
});

describe("chemin Storage (policy 0011_import.sql)", () => {
  it("construit le chemin attendu par les policies", () => {
    expect(buildImportStoragePath(ORG_ID, SESSION_ID, DOCUMENT_ID, "facture.pdf")).toBe(
      `organizations/${ORG_ID}/imports/${SESSION_ID}/documents/${DOCUMENT_ID}/facture.pdf`
    );
    expect(
      importStoragePathSchema.safeParse(
        buildImportStoragePath(ORG_ID, SESSION_ID, DOCUMENT_ID, "facture.pdf")
      ).success
    ).toBe(true);
  });

  it("neutralise les séparateurs de chemin dans le nom de fichier", () => {
    const path = buildImportStoragePath(
      ORG_ID,
      SESSION_ID,
      DOCUMENT_ID,
      "dossier/facture\\2026.pdf"
    );
    expect(path).not.toContain("\\");
    expect(path.endsWith("/dossier_facture_2026.pdf")).toBe(true);
    expect(importStoragePathSchema.safeParse(path).success).toBe(true);
  });

  it("rejette un chemin ne respectant pas la structure imposée", () => {
    expect(importStoragePathSchema.safeParse(`imports/${SESSION_ID}/doc.pdf`).success).toBe(
      false
    );
    expect(
      importStoragePathSchema.safeParse(
        `organizations/${ORG_ID}/imports/${SESSION_ID}/documents/${DOCUMENT_ID}`
      ).success
    ).toBe(false);
    expect(
      importStoragePathSchema.safeParse(
        `organizations/pas-un-uuid/imports/${SESSION_ID}/documents/${DOCUMENT_ID}/f.pdf`
      ).success
    ).toBe(false);
  });
});

describe("transitions d'état", () => {
  it("session : graphe autorisé", () => {
    expect(canTransitionImportSession("collecting", "processing")).toBe(true);
    expect(canTransitionImportSession("processing", "needs_review")).toBe(true);
    expect(canTransitionImportSession("needs_review", "ready")).toBe(true);
    expect(canTransitionImportSession("ready", "importing")).toBe(true);
    expect(canTransitionImportSession("importing", "completed")).toBe(true);
    expect(canTransitionImportSession("failed", "collecting")).toBe(true);
  });

  it("session : transitions interdites", () => {
    expect(canTransitionImportSession("collecting", "completed")).toBe(false);
    expect(canTransitionImportSession("completed", "cancelled")).toBe(false);
    expect(canTransitionImportSession("cancelled", "collecting")).toBe(false);
    expect(canTransitionImportSession("collecting", "collecting")).toBe(false);
    expect(canTransitionImportSession("importing", "needs_review")).toBe(false);
  });

  it("document : parsing → extraction puis terminal", () => {
    expect(canTransitionImportDocument("uploading", "uploaded")).toBe(true);
    expect(canTransitionImportDocument("parsing", "parsed")).toBe(true);
    expect(canTransitionImportDocument("parsed", "extracting")).toBe(true);
    expect(canTransitionImportDocument("extracting", "extracted")).toBe(true);
    expect(canTransitionImportDocument("extracted", "failed")).toBe(false);
    expect(canTransitionImportDocument("uploaded", "extracted")).toBe(false);
    expect(canTransitionImportDocument("failed", "parsing")).toBe(true);
    expect(canTransitionImportDocument("failed", "uploaded")).toBe(false);
  });

  it("item : review → import, import terminal", () => {
    expect(canTransitionImportItemStatus("pending", "validated")).toBe(true);
    expect(canTransitionImportItemStatus("validated", "imported")).toBe(true);
    expect(canTransitionImportItemStatus("failed", "pending")).toBe(true);
    expect(canTransitionImportItemStatus("ignored", "validated")).toBe(true);
    expect(canTransitionImportItemStatus("imported", "pending")).toBe(false);
    expect(canTransitionImportItemStatus("pending", "imported")).toBe(false);
  });
});
