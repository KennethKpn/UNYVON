import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Fake Supabase minimal (lecture seule) + fake provider contrôlé
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;

  const ORG = "11111111-1111-4111-8111-111111111111";
  const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
  const SESSION = "22222222-2222-4222-8222-222222222222";
  const DOC = "33333333-3333-4333-8333-333333333333";
  const USER = "55555555-5555-4555-8555-555555555555";

  const db = {
    documents: [] as Row[],
    roles: { [ORG]: "owner" } as Record<string, string | null>,
    user: { id: USER } as { id: string } | null,
    writes: [] as string[],
    storageDownloads: [] as Array<{ bucket: string; path: string }>,
    downloadBytes: null as Uint8Array | null,
    downloadError: null as string | null,
  };

  function documentRow(overrides: Row = {}): Row {
    return {
      id: DOC,
      session_id: SESSION,
      organization_id: ORG,
      original_name: "stock.md",
      source_kind: "md",
      mime_type: "text/markdown",
      size_bytes: 1024,
      storage_path: `organizations/${ORG}/imports/${SESSION}/documents/${DOC}/stock.md`,
      state: "uploaded",
      page_count: null,
      error_message: null,
      processed_at: null,
      created_at: "2026-09-29T00:00:00+00:00",
      updated_at: "2026-09-29T00:00:00+00:00",
      ...overrides,
    };
  }

  function builder(table: string) {
    const filters: Array<[string, unknown]> = [];
    const api = {
      select() {
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push([col, val]);
        return api;
      },
      order() {
        return api;
      },
      limit() {
        return api;
      },
      insert(payload: Row) {
        db.writes.push(`insert:${table}`);
        return { ...api, select: () => api, single: () => Promise.resolve({ data: payload, error: null }) };
      },
      update() {
        db.writes.push(`update:${table}`);
        return { ...api, select: () => api, single: () => Promise.resolve({ data: null, error: null }) };
      },
      delete() {
        db.writes.push(`delete:${table}`);
        return { ...api };
      },
      then(
        onFulfilled?: (v: { data: unknown; error: unknown }) => unknown,
        onRejected?: (e: unknown) => unknown
      ) {
        const rows = (table === "import_documents" ? db.documents : []).filter((row) =>
          filters.every(([col, val]) => row[col] === val)
        );
        return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
      },
    };
    return api;
  }

  const client = {
    auth: {
      getUser: async () => ({ data: { user: db.user }, error: null }),
    },
    rpc: async (fn: string, args?: unknown) => {
      const orgId = (args as { org_id?: string } | undefined)?.org_id;
      if (fn === "current_org_role") {
        return { data: orgId ? (db.roles[orgId] ?? null) : null, error: null };
      }
      return { data: null, error: null };
    },
    from: (table: string) => builder(table),
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          db.storageDownloads.push({ bucket, path });
          if (db.downloadError) return { data: null, error: { message: db.downloadError } };
          return {
            data: {
              arrayBuffer: async () =>
                (db.downloadBytes ?? new TextEncoder().encode("# Vide").buffer),
            },
            error: null,
          };
        },
      }),
    },
  };

  const providerState = {
    provider: null as unknown,
    parseCalls: [] as unknown[],
  };

  function reset() {
    db.documents = [];
    db.roles = { [ORG]: "owner" };
    db.user = { id: USER };
    db.writes = [];
    db.storageDownloads = [];
    db.downloadBytes = null;
    db.downloadError = null;
    providerState.provider = {
      name: "fake-provider",
      async parse(request: unknown) {
        providerState.parseCalls.push(request);
        return {
          candidates: [
            {
              entityType: "product",
              fields: { name: { raw: "Huile de palme", confidence: "high", page: 1 } },
            },
          ],
        };
      },
    };
    providerState.parseCalls = [];
  }

  return { db, client, documentRow, reset, providerState, ORG, OTHER_ORG, SESSION, DOC, USER };
});

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => h.client,
}));

vi.mock("@/lib/import/extraction/provider", () => ({
  createDefaultProvider: () => h.providerState.provider,
}));

import { extractImportDocument } from "../supabase/import-actions";

beforeEach(() => {
  h.reset();
});

describe("extractImportDocument (Storage → extraction, lecture seule)", () => {
  it("extrait le document depuis Storage et retourne la structure validée", async () => {
    h.db.documents = [h.documentRow()];
    h.db.downloadBytes = new TextEncoder().encode("# Huile de palme — 2500 FCFA");

    const result = await extractImportDocument(h.DOC);

    expect(result.documentId).toBe(h.DOC);
    expect(result.status).toBe("SUCCESS");
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].documentId).toBe(h.DOC);
    expect(h.db.storageDownloads).toEqual([
      {
        bucket: "imports",
        path: `organizations/${h.ORG}/imports/${h.SESSION}/documents/${h.DOC}/stock.md`,
      },
    ]);
  });

  it("n'écrit dans AUCUNE table (ni métier ni import) — lecture seule", async () => {
    h.db.documents = [h.documentRow()];
    h.db.downloadBytes = new TextEncoder().encode("# contenu");

    await extractImportDocument(h.DOC);

    expect(h.db.writes).toEqual([]);
    expect(h.db.documents[0].state).toBe("uploaded");
    expect(h.db.documents[0].processed_at).toBeNull();
  });

  it("refuse un document appartenant à une autre organisation (RBAC)", async () => {
    h.db.documents = [h.documentRow({ organization_id: h.OTHER_ORG })];
    h.db.roles = { [h.ORG]: "owner" };

    await expect(extractImportDocument(h.DOC)).rejects.toThrow(
      "Seuls les propriétaires et managers peuvent gérer les imports"
    );
    expect(h.db.writes).toEqual([]);
  });

  it("rejette un utilisateur non authentifié", async () => {
    h.db.user = null;
    await expect(extractImportDocument(h.DOC)).rejects.toThrow("Non authentifié");
  });

  it("document introuvable : erreur claire", async () => {
    h.db.documents = [];
    await expect(extractImportDocument(h.DOC)).rejects.toThrow("Document d'import introuvable");
  });

  it("erreur de téléchargement Storage : erreur française, aucune écriture", async () => {
    h.db.documents = [h.documentRow()];
    h.db.downloadError = "Object not found";

    await expect(extractImportDocument(h.DOC)).rejects.toThrow(/téléchargement/);
    expect(h.db.writes).toEqual([]);
  });

  it("fournisseur IA absent : extraction retourne PARTIAL/FAILED sans crash", async () => {
    h.db.documents = [h.documentRow()];
    h.db.downloadBytes = new TextEncoder().encode("# texte présent");
    h.providerState.provider = null;

    const result = await extractImportDocument(h.DOC);
    expect(["PARTIAL", "FAILED"]).toContain(result.status);
    expect(result.candidates).toHaveLength(0);
    expect(h.db.writes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Finding #3 : l'extraction exige state = 'uploaded' (exactement).
// Précondition évaluée AVANT toute I/O : aucun téléchargement, aucun appel IA.
// ---------------------------------------------------------------------------

describe("extractImportDocument — précondition d'état 'uploaded'", () => {
  it("refuse 'uploading' : ni téléchargement ni appel IA", async () => {
    h.db.documents = [h.documentRow({ state: "uploading" })];
    h.db.downloadBytes = new TextEncoder().encode("# contenu");

    await expect(extractImportDocument(h.DOC)).rejects.toThrow(
      "Extraction autorisée uniquement depuis l'état 'uploaded' (état actuel : uploading)"
    );

    // Point central du finding : la garde précède l'extraction coûteuse.
    expect(h.db.storageDownloads).toEqual([]);
    expect(h.providerState.parseCalls).toEqual([]);
    expect(h.db.writes).toEqual([]);
  });

  it.each([
    "parsing",
    "parsed",
    "extracting",
    "extracted",
    "failed",
  ])("refuse l'état '%s' (jamais une extraction coûteuse)", async (state) => {
    h.db.documents = [h.documentRow({ state })];
    h.db.downloadBytes = new TextEncoder().encode("# contenu");

    await expect(extractImportDocument(h.DOC)).rejects.toThrow(
      `Extraction autorisée uniquement depuis l'état 'uploaded' (état actuel : ${state})`
    );

    expect(h.db.storageDownloads).toEqual([]);
    expect(h.providerState.parseCalls).toEqual([]);
    expect(h.db.writes).toEqual([]);
  });

  it("autorise 'uploaded' et effectue alors téléchargement + extraction", async () => {
    h.db.documents = [h.documentRow({ state: "uploaded" })];
    h.db.downloadBytes = new TextEncoder().encode("# Huile de palme — 2500 FCFA");

    const result = await extractImportDocument(h.DOC);

    expect(result.status).toBe("SUCCESS");
    expect(h.db.storageDownloads).toEqual([
      {
        bucket: "imports",
        path: `organizations/${h.ORG}/imports/${h.SESSION}/documents/${h.DOC}/stock.md`,
      },
    ]);
    expect(h.providerState.parseCalls).toHaveLength(1);
  });

  it("la garde d'état ne contourne pas le contrôle d'organisation", async () => {
    // state invalide ET autre organisation : l'erreur de rôle reste prioritaire
    // (les gardes d'auth/RBAC précèdent la logique métier).
    h.db.documents = [
      h.documentRow({ organization_id: h.OTHER_ORG, state: "uploading" }),
    ];
    h.db.roles = { [h.ORG]: "owner" };

    await expect(extractImportDocument(h.DOC)).rejects.toThrow(
      "Seuls les propriétaires et managers peuvent gérer les imports"
    );
    expect(h.db.storageDownloads).toEqual([]);
  });
});
