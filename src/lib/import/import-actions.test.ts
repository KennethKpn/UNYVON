import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Fake Supabase contrôlé par vi.hoisted (accessible dans le factory vi.mock).
// Mimique strictement les chaînes utilisées par import-actions :
//   auth.getUser / rpc("current_org_role") / from().select().eq().order()
//   / from().insert().select().single() / from().update().eq().select().single()
//   / from().delete().eq() / .single() → { data, error } (PGRST116 si vide)
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;

  const ORG = "11111111-1111-4111-8111-111111111111";
  const SESSION = "22222222-2222-4222-8222-222222222222";
  const DOC = "33333333-3333-4333-8333-333333333333";
  const USER = "55555555-5555-4555-8555-555555555555";

  const rpcCalls: Array<{ fn: string; args: unknown }> = [];
  const storageCalls: Array<{ bucket: string; paths: string[] }> = [];
  const storageListCalls: Array<{
    bucket: string;
    folder: string;
    search?: string;
  }> = [];

  const db = {
    sessions: [] as Row[],
    documents: [] as Row[],
    items: [] as Row[],
    organizations: [] as Row[],
    memberships: [] as Row[],
    roles: { [ORG]: "owner" } as Record<string, string | null>,
    user: { id: USER } as { id: string } | null,
    insertError: null as string | null,
    updateError: null as string | null,
    deleteError: null as string | null,
    removeError: null as string | null,
    listError: null as string | null,
    // Chemins d'objets réellement présents dans le bucket. Vide = aucun objet.
    storageObjects: [] as string[],
    downloadBytes: new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]),
    extractionQueue: [] as Array<{
      raw?: unknown;
      local?: unknown;
      structured?: unknown;
    }>,
    rpcMaterializeError: null as string | null,
    mutationRace: null as (() => void) | null,
  };

  const TABLES: Record<string, Row[]> = {
    get import_sessions() {
      return db.sessions;
    },
    get import_documents() {
      return db.documents;
    },
    get import_items() {
      return db.items;
    },
    get organizations() {
      return db.organizations;
    },
    get organization_users() {
      return db.memberships;
    },
  };

  function reset() {
    db.sessions = [];
    db.documents = [];
    db.items = [];
    db.organizations = [{ id: ORG, created_by: USER, created_at: "2026-09-01T00:00:00+00:00" }];
    db.memberships = [
      { organization_id: ORG, user_id: USER, created_at: "2026-09-01T00:00:00+00:00" },
    ];
    db.roles = { [ORG]: "owner" };
    db.user = { id: USER };
    db.insertError = null;
    db.updateError = null;
    db.deleteError = null;
    db.removeError = null;
    db.listError = null;
    db.storageObjects = [];
    db.downloadBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
    db.extractionQueue = [];
    db.rpcMaterializeError = null;
    db.mutationRace = null;
    rpcCalls.length = 0;
    storageCalls.length = 0;
    storageListCalls.length = 0;
  }

  function sessionRow(overrides: Row = {}): Row {
    return {
      id: SESSION,
      organization_id: ORG,
      created_by: USER,
      state: "collecting",
      created_at: "2026-09-29T00:00:00+00:00",
      updated_at: "2026-09-29T00:00:00+00:00",
      ...overrides,
    };
  }

  function documentRow(overrides: Row = {}): Row {
    return {
      id: DOC,
      session_id: SESSION,
      organization_id: ORG,
      original_name: "stock.pdf",
      source_kind: "pdf",
      mime_type: "application/pdf",
      size_bytes: 1024,
      storage_path: `organizations/${ORG}/imports/${SESSION}/documents/${DOC}/stock.pdf`,
      state: "uploading",
      page_count: null,
      parsed_artifact: null,
      parsed_at: null,
      error_message: null,
      processed_at: null,
      created_at: "2026-09-29T00:00:00+00:00",
      updated_at: "2026-09-29T00:00:00+00:00",
      ...overrides,
    };
  }

  function builder(table: string) {
    const st = {
      op: "select" as "select" | "insert" | "update" | "delete",
      filters: [] as Array<[string, unknown]>,
      payload: null as Row | null,
      orderBy: null as string | null,
      descending: false,
      selectedCols: "*",
      limitN: 0,
    };

    function selectedRows(): Row[] {
      const rows = [...(TABLES[table] ?? [])];
      let out = rows.filter((row) =>
        st.filters.every(([col, val]) => row[col] === val)
      );
      if (st.orderBy) {
        const key = st.orderBy;
        out = out.sort((a, b) => {
          const cmp = String(a[key]).localeCompare(String(b[key]));
          return st.descending ? -cmp : cmp;
        });
      }
      return out;
    }

    function run(): { data: unknown; error: { message: string } | null } {
      if (st.op === "insert") {
        if (db.insertError) return { data: null, error: { message: db.insertError } };
        const rows = TABLES[table] ?? [];
        rows.push({ ...(st.payload as Row) });
        return { data: [st.payload], error: null };
      }
      if (st.op === "update") {
        if (db.updateError) return { data: null, error: { message: db.updateError } };
        if (db.mutationRace) {
          const race = db.mutationRace;
          db.mutationRace = null;
          race();
        }
        const rows = selectedRows();
        for (const row of rows) Object.assign(row, st.payload);
        return { data: rows, error: null };
      }
      if (st.op === "delete") {
        if (db.deleteError) return { data: null, error: { message: db.deleteError } };
        if (db.mutationRace) {
          const race = db.mutationRace;
          db.mutationRace = null;
          race();
        }
        const tableRows = TABLES[table] ?? [];
        const selected = selectedRows();
        const toRemove = new Set(selected);
        for (let i = tableRows.length - 1; i >= 0; i--) {
          if (toRemove.has(tableRows[i])) tableRows.splice(i, 1);
        }
        return { data: selected, error: null };
      }
      return { data: selectedRows(), error: null };
    }

    const api = {
      select(cols?: string) {
        st.selectedCols = cols ?? "*";
        return api;
      },
      eq(col: string, val: unknown) {
        st.filters.push([col, val]);
        return api;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        st.orderBy = col;
        st.descending = opts?.ascending === false;
        return api;
      },
      limit(n: number) {
        st.limitN = n;
        return api;
      },
      insert(payload: Row) {
        st.op = "insert";
        st.payload = payload;
        return api;
      },
      update(payload: Row) {
        st.op = "update";
        st.payload = payload;
        return api;
      },
      delete() {
        st.op = "delete";
        return api;
      },
      single() {
        const result = run();
        if (result.error) return Promise.resolve({ data: null, error: result.error });
        const rows = result.data as Row[];
        if (rows.length !== 1) {
          return Promise.resolve({
            data: null,
            error: { message: "JSON object requested, multiple (or no) rows returned" },
          });
        }
        return Promise.resolve({ data: rows[0], error: null });
      },
      maybeSingle() {
        const result = run();
        if (result.error) return Promise.resolve({ data: null, error: result.error });
        const rows = result.data as Row[];
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then(
        onFulfilled?: (v: { data: unknown; error: unknown }) => unknown,
        onRejected?: (e: unknown) => unknown
      ) {
        return Promise.resolve(run()).then(onFulfilled, onRejected);
      },
    };
    return api;
  }

  const client = {
    auth: {
      getUser: async () => ({ data: { user: db.user }, error: null }),
    },
    rpc: async (fn: string, args?: unknown) => {
      rpcCalls.push({ fn, args });
      const orgId = (args as { org_id?: string } | undefined)?.org_id;
      if (fn === "current_org_role") {
        return { data: orgId ? (db.roles[orgId] ?? null) : null, error: null };
      }
      if (fn === "materialize_import_document") {
        if (db.rpcMaterializeError) {
          return { data: null, error: { message: db.rpcMaterializeError } };
        }
        const documentId = (args as { p_document_id: string }).p_document_id;
        const document = db.documents.find((row) => row.id === documentId);
        if (document) {
          document.state = "extracted";
          document.page_count = (args as { p_page_count: number }).p_page_count;
          document.error_message = null;
          document.processed_at = "2026-10-05T00:00:00+00:00";
        }
        const session = db.sessions.find((row) => row.id === document?.session_id);
        if (session && document && db.documents.every((row) => row.session_id !== session.id || row.state === "extracted")) {
          session.state = "needs_review";
        }
        return { data: db.items, error: null };
      }
      return { data: null, error: null };
    },
    from: (table: string) => builder(table),
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          storageCalls.push({ bucket, paths });
          for (const path of paths) {
            db.storageObjects = db.storageObjects.filter((p) => p !== path);
          }
          return {
            data: null,
            error: db.removeError ? { message: db.removeError } : null,
          };
        },
        // list(folder, { search }) : ne renvoie que les fichiers du dossier,
        // `id` non nul. Reproduit le filtrage exact + préfixe de `search`.
        download: async (_path: string) => ({
          data: new Blob([db.downloadBytes]),
          error: null,
        }),
        list: async (folder: string, opts?: { search?: string }) => {
          storageListCalls.push({
            bucket,
            folder,
            ...(opts?.search !== undefined ? { search: opts.search } : {}),
          });
          if (db.listError) {
            return { data: null, error: { message: db.listError } };
          }
          const prefix = `${folder}/`;
          const data = db.storageObjects
            .filter((path) => path.startsWith(prefix))
            .filter((path) => !path.slice(prefix.length).includes("/"))
            .filter(
              (path) =>
                opts?.search === undefined ||
                path.slice(prefix.length).startsWith(opts.search)
            )
            .map((path) => ({
              id: `obj-${path.length}`,
              name: path.slice(prefix.length),
            }));
          return { data, error: null };
        },
      }),
    },
  };

  return {
    db,
    client,
    reset,
    sessionRow,
    documentRow,
    rpcCalls,
    storageCalls,
    storageListCalls,
    ORG,
    OTHER_ORG: "99999999-9999-4999-8999-999999999999",
    SESSION,
    DOC,
    USER,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => h.client,
}));

vi.mock("@/lib/import/extraction", () => ({
  createDefaultProvider: () => ({
    name: "test",
    parse: async () => {
      const next = h.db.extractionQueue.shift();
      return next?.raw ?? {
        candidates: [],
      };
    },
  }),
  parseDocumentLocally: (_input: unknown) => {
    const next = h.db.extractionQueue.shift();
    if (next?.local) return next.local;
    return {
      status: "READY",
      artifact: {
        version: 1,
        source: "pdf-local",
        pages: [
      { page: 1, text: "Produit Test" },
      { page: 2, text: "Suite Produit Test" },
    ],
        warnings: [],
      },
    };
  },
  parsePersistedArtifact: (value: unknown) => value,
  structureParsedDocument: async (_input: unknown, _artifact: unknown, _provider: unknown) => {
    const next = h.db.extractionQueue.shift();
    if (next?.structured) return next.structured;
    return {
      status: "SUCCESS",
      documentId: h.DOC,
      sourceKind: "pdf",
      source: "pdf-local",
      pages: [{ page: 1, text: "Produit Test" }],
      candidates: [],
      warnings: [],
      errors: [],
    };
  },
}));

import {
  addImportDocument,
  cancelImportSession,
  extractionDiagnostics,
  createImportSession,
  deleteImportDocument,
  deleteImportItem,
  updateImportItemFields,
  getImportDocuments,
  getImportSession,
  getImportSessions,
  markImportDocumentUploaded,
  markImportDocumentUploadFailed,
  materializeImportDocument,
  startImportProcessing,
} from "../supabase/import-actions";

beforeEach(() => {
  h.reset();
});

describe("extractionDiagnostics", () => {
  it("confirme une lecture locale même lorsque la structuration IA échoue", async () => {
    const message = await extractionDiagnostics({
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
    expect(message).toContain("36 caractères");
  });

  it("distingue un PDF sans texte local ayant basculé vers le fallback visuel", async () => {
    const message = await extractionDiagnostics({
      status: "FAILED",
      documentId: h.DOC,
      sourceKind: "pdf",
      source: "pdf-llm",
      pages: [],
      candidates: [],
      warnings: [],
      errors: [{ code: "PROVIDER_ERROR", message: "timeout" }],
    });

    expect(message).toContain("aucun texte exploitable");
    expect(message).toContain("fallback visuel IA");
  });
});

describe("createImportSession", () => {
  it("crée une session en état collecting pour un owner, org dérivée serveur", async () => {
    const row = await createImportSession();
    expect(row.state).toBe("collecting");
    expect(row.organization_id).toBe(h.ORG);
    expect(row.created_by).toBe(h.USER);
    expect(h.db.sessions).toHaveLength(1);
    expect(h.rpcCalls.at(-1)).toEqual({
      fn: "current_org_role",
      args: { org_id: h.ORG },
    });
  });

  it("accepte un rôle manager", async () => {
    h.db.roles[h.ORG] = "manager";
    const row = await createImportSession();
    expect(row.organization_id).toBe(h.ORG);
  });

  it("rejette un utilisateur non authentifié", async () => {
    h.db.user = null;
    await expect(createImportSession()).rejects.toThrow("Non authentifié");
  });

  it("rejette un rôle vendeur", async () => {
    h.db.roles[h.ORG] = "seller";
    await expect(createImportSession()).rejects.toThrow(
      "Seuls les propriétaires et managers peuvent gérer les imports"
    );
    expect(h.db.sessions).toHaveLength(0);
  });

  it("rejette un utilisateur sans aucune organisation", async () => {
    h.db.organizations = [];
    h.db.memberships = [];
    await expect(createImportSession()).rejects.toThrow(
      "Aucune organisation"
    );
    expect(h.db.sessions).toHaveLength(0);
  });
});

describe("getImportSessions / getImportSession", () => {
  it("retourne les sessions de l'org triées du plus récent au plus ancien", async () => {
    h.db.sessions = [
      h.sessionRow({ id: h.SESSION, created_at: "2026-09-29T00:00:00+00:00" }),
      h.sessionRow({
        id: "66666666-6666-4666-8666-666666666666",
        created_at: "2026-09-28T00:00:00+00:00",
      }),
    ];
    const rows = await getImportSessions();
    expect(rows).toHaveLength(2);
    expect(rows[0].created_at).toBe("2026-09-29T00:00:00+00:00");
  });

  it("retourne null pour une session inexistante", async () => {
    expect(await getImportSession(h.SESSION)).toBeNull();
  });

  it("rejette un utilisateur non authentifié", async () => {
    h.db.user = null;
    await expect(getImportSessions()).rejects.toThrow("Non authentifié");
  });
});

describe("addImportDocument", () => {
  const input = {
    sessionId: h.SESSION,
    originalName: "stock-2026.pdf",
    sourceKind: "pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
  } as const;

  beforeEach(() => {
    h.db.sessions = [h.sessionRow()];
  });

  it("insère la row en uploading avec le chemin Storage exact", async () => {
    const result = await addImportDocument(input);
    expect(result.document.state).toBe("uploading");
    expect(result.document.original_name).toBe("stock-2026.pdf");
    expect(result.storagePath).toBe(
      `organizations/${h.ORG}/imports/${h.SESSION}/documents/${result.document.id}/stock-2026.pdf`
    );
    expect(result.document.storage_path).toBe(result.storagePath);
    expect(h.db.documents).toHaveLength(1);
  });

  it("rejette la session introuvable (RLS ou id incorrect)", async () => {
    h.db.sessions = [];
    await expect(addImportDocument(input)).rejects.toThrow(
      "Session d'import introuvable"
    );
  });

  it("rejette un rôle hors owner/manager", async () => {
    h.db.roles[h.ORG] = "seller";
    await expect(addImportDocument(input)).rejects.toThrow(
      "Seuls les propriétaires et managers peuvent gérer les imports"
    );
  });

  it("rejette une session d'une autre organisation (aucun accès cross-org)", async () => {
    h.db.sessions = [h.sessionRow({ organization_id: h.OTHER_ORG })];
    await expect(addImportDocument(input)).rejects.toThrow(
      "Seuls les propriétaires et managers peuvent gérer les imports"
    );
    expect(h.db.documents).toHaveLength(0);
  });

  it("rejette l'ajout hors phase de collecte", async () => {
    h.db.sessions = [h.sessionRow({ state: "processing" })];
    await expect(addImportDocument(input)).rejects.toThrow(
      "Les documents ne peuvent être ajoutés qu'en phase de collecte"
    );
    expect(h.db.documents).toHaveLength(0);
  });

  it("rejette l'ajout sur une session terminée", async () => {
    h.db.sessions = [h.sessionRow({ state: "completed" })];
    await expect(addImportDocument(input)).rejects.toThrow(
      "Les documents ne peuvent être ajoutés qu'en phase de collecte"
    );
    expect(h.db.documents).toHaveLength(0);
  });

  it("accepte plusieurs documents dans une même session", async () => {
    const first = await addImportDocument(input);
    const second = await addImportDocument({
      ...input,
      originalName: "factures.pdf",
      sizeBytes: 2048,
    });
    expect(first.document.id).not.toBe(second.document.id);
    expect(first.storagePath).not.toBe(second.storagePath);
    expect(h.db.documents).toHaveLength(2);
    expect(
      h.db.documents.every((d) => d.session_id === h.SESSION)
    ).toBe(true);
  });

  it("reste réutilisable : la session demeure en collecting après ajout", async () => {
    await addImportDocument(input);
    const session = await getImportSession(h.SESSION);
    expect(session?.state).toBe("collecting");
    const resumed = await addImportDocument({
      ...input,
      originalName: "reprise.pdf",
    });
    expect(resumed.document.state).toBe("uploading");
    expect(await getImportDocuments(h.SESSION)).toHaveLength(2);
  });

  it("rejette une taille de fichier au-delà de 25 Mo (zod)", async () => {
    await expect(
      addImportDocument({ ...input, sizeBytes: 25 * 1024 * 1024 + 1 })
    ).rejects.toThrow();
    expect(h.db.documents).toHaveLength(0);
  });

  it("rejette un source_kind hors de la liste SQL (zod)", async () => {
    await expect(
      addImportDocument({ ...input, sourceKind: "xlsx" as "pdf" })
    ).rejects.toThrow();
  });

  it("propage une erreur d'insertion sans créer de document (aucun chemin retourné)", async () => {
    h.db.insertError = "boom";
    await expect(addImportDocument(input)).rejects.toThrow(
      "Erreur ajout document: boom"
    );
    expect(h.db.documents).toHaveLength(0);
  });
});

describe("markImportDocumentUploaded", () => {
  const expectedPath = `organizations/${h.ORG}/imports/${h.SESSION}/documents/${h.DOC}/stock.pdf`;
  const expectedFolder = `organizations/${h.ORG}/imports/${h.SESSION}/documents/${h.DOC}`;

  beforeEach(() => {
    h.db.sessions = [h.sessionRow()];
    h.db.documents = [h.documentRow()];
    // Par défaut l'objet existe : les cas historiques testent le graphe d'états,
    // pas la présence Storage (isolée dans les cas dédiés ci-dessous).
    h.db.storageObjects = [expectedPath];
  });

  // --- Finding #2 : uploaded exige l'objet Storage correspondant -------------

  it("1. objet présent -> transition uploading → uploaded autorisée", async () => {
    h.db.storageObjects = [expectedPath];

    const row = await markImportDocumentUploaded(h.DOC);

    expect(row.state).toBe("uploaded");
    // Vérification faite sur le dossier ET le nom exact du document.
    expect(h.storageListCalls).toEqual([
      { bucket: "imports", folder: expectedFolder, search: "stock.pdf" },
    ]);
  });

  it("2. objet absent -> transition refusée, AUCUNE écriture (pas de faux positif uploaded)", async () => {
    h.db.storageObjects = [];

    await expect(markImportDocumentUploaded(h.DOC)).rejects.toThrow(
      "Objet Storage absent"
    );

    // La row reste 'uploading' : l'extraction ne peut pas être débloquée.
    expect(h.db.documents[0].state).toBe("uploading");
    expect(h.storageListCalls).toHaveLength(1);
  });

  it("2b. objet au nom approchant (même préfixe) -> refusé (pas de faux positif)", async () => {
    h.db.storageObjects = [`${expectedFolder}/stock.pdf.bak`];

    await expect(markImportDocumentUploaded(h.DOC)).rejects.toThrow(
      "Objet Storage absent"
    );
    expect(h.db.documents[0].state).toBe("uploading");
  });

  it("2c. objet dans un AUTRE dossier du même document -> refusé (pas de faux positif)", async () => {
    const otherFolder = `organizations/${h.ORG}/imports/${h.SESSION}/documents/44444444-4444-4444-8444-444444444444`;
    h.db.storageObjects = [`${otherFolder}/stock.pdf`];

    await expect(markImportDocumentUploaded(h.DOC)).rejects.toThrow(
      "Objet Storage absent"
    );
    expect(h.db.documents[0].state).toBe("uploading");
  });

  it("2d. erreur de lecture Storage -> refus explicite, aucune écriture", async () => {
    h.db.listError = "bucket indisponible";

    await expect(markImportDocumentUploaded(h.DOC)).rejects.toThrow(
      "Erreur vérification objet Storage: bucket indisponible"
    );
    expect(h.db.documents[0].state).toBe("uploading");
  });

  it("3. utilisateur non autorisé (rôle seller) -> refus, aucun accès Storage", async () => {
    h.db.roles[h.ORG] = "seller";
    h.db.storageObjects = [expectedPath];

    await expect(markImportDocumentUploaded(h.DOC)).rejects.toThrow(
      "Seuls les propriétaires et managers peuvent gérer les imports"
    );
    expect(h.db.documents[0].state).toBe("uploading");
    expect(h.storageListCalls).toHaveLength(0);
  });

  it("3b. non authentifié -> refus, aucun accès Storage", async () => {
    h.db.user = null;
    h.db.storageObjects = [expectedPath];

    await expect(markImportDocumentUploaded(h.DOC)).rejects.toThrow(
      "Non authentifié"
    );
    expect(h.storageListCalls).toHaveLength(0);
  });

  it("4. document d'une AUTRE organisation -> refus, aucun accès Storage", async () => {
    // L'utilisateur est owner de h.ORG ; le document appartient à h.OTHER_ORG
    // (donc current_org_role(OTHER_ORG) = null). Sans contrôle du
    // organization_id porté par le document, l'upload serait validé à tort.
    h.db.documents = [
      h.documentRow({
        organization_id: h.OTHER_ORG,
        storage_path: `organizations/${h.OTHER_ORG}/imports/${h.SESSION}/documents/${h.DOC}/stock.pdf`,
      }),
    ];
    h.db.roles = { [h.ORG]: "owner" };
    h.db.storageObjects = [
      `organizations/${h.OTHER_ORG}/imports/${h.SESSION}/documents/${h.DOC}/stock.pdf`,
    ];

    await expect(markImportDocumentUploaded(h.DOC)).rejects.toThrow(
      "Seuls les propriétaires et managers peuvent gérer les imports"
    );
    expect(h.db.documents[0].state).toBe("uploading");
    expect(h.storageListCalls).toHaveLength(0);
  });

  // --- Comportement historique conservé -------------------------------------

  it("refuse une transition hors graphe (parsed → uploaded)", async () => {
    h.db.documents = [h.documentRow({ state: "parsed" })];
    await expect(markImportDocumentUploaded(h.DOC)).rejects.toThrow(
      "Transition d'état non autorisée"
    );
    expect(h.db.documents[0].state).toBe("parsed");
  });

  it("rejette un document introuvable", async () => {
    h.db.documents = [];
    await expect(markImportDocumentUploaded(h.DOC)).rejects.toThrow(
      "Document d'import introuvable"
    );
  });

  it("refuse un chemin Storage n'appartenant pas au document (avant tout accès Storage)", async () => {
    h.db.documents = [
      h.documentRow({
        storage_path: `organizations/${h.ORG}/imports/${h.SESSION}/documents/44444444-4444-4444-8444-444444444444/stock.pdf`,
      }),
    ];

    await expect(markImportDocumentUploaded(h.DOC)).rejects.toThrow(
      "Chemin Storage du document invalide"
    );
    expect(h.storageListCalls).toHaveLength(0);
    expect(h.db.documents[0].state).toBe("uploading");
  });
});

describe("markImportDocumentUploadFailed", () => {
  beforeEach(() => {
    h.db.sessions = [h.sessionRow()];
    h.db.documents = [h.documentRow()];
  });

  it("autorise uploading → failed et enregistre le message", async () => {
    const row = await markImportDocumentUploadFailed(h.DOC, "Réseau indisponible");
    expect(row.state).toBe("failed");
    expect(row.error_message).toBe("Réseau indisponible");
  });

  it("refuse failed depuis un état terminal (extracted)", async () => {
    h.db.documents = [h.documentRow({ state: "extracted" })];
    await expect(
      markImportDocumentUploadFailed(h.DOC, "x")
    ).rejects.toThrow("Transition d'état non autorisée");
  });
});

describe("deleteImportDocument", () => {
  beforeEach(() => {
    h.db.sessions = [h.sessionRow()];
    h.db.documents = [h.documentRow()];
  });

  const expectedPath = `organizations/${h.ORG}/imports/${h.SESSION}/documents/${h.DOC}/stock.pdf`;

  it("supprime la row ET l'objet Storage (aucun objet orphelin)", async () => {
    await deleteImportDocument(h.DOC);
    expect(h.db.documents).toHaveLength(0);
    expect(h.storageCalls).toEqual([
      { bucket: "imports", paths: [expectedPath] },
    ]);
  });

  it("supprime un document en failed (row + objet)", async () => {
    h.db.documents = [h.documentRow({ state: "failed" })];
    await deleteImportDocument(h.DOC);
    expect(h.db.documents).toHaveLength(0);
    expect(h.storageCalls).toHaveLength(1);
    expect(h.storageCalls[0].paths).toEqual([expectedPath]);
  });

  it("passe processing → needs_review quand le dernier document non-extrait est supprimé", async () => {
    const secondId = "77777777-7777-4777-8777-777777777777";
    h.db.sessions = [h.sessionRow({ state: "processing" })];
    h.db.documents = [
      h.documentRow({ state: "failed" }),
      h.documentRow({ id: secondId, state: "extracted", original_name: "autre.pdf" }),
    ];

    await deleteImportDocument(h.DOC);

    expect(h.db.documents.map((doc) => doc.state)).toEqual(["extracted"]);
    expect(h.db.sessions[0].state).toBe("needs_review");
  });

  it("ne laisse pas une session processing sans document après suppression du dernier document", async () => {
    h.db.sessions = [h.sessionRow({ state: "processing" })];
    h.db.documents = [h.documentRow({ state: "failed" })];

    await deleteImportDocument(h.DOC);

    expect(h.db.documents).toHaveLength(0);
    expect(h.db.sessions[0].state).toBe("failed");
    expect(h.db.sessions[0].error_message).toBe(
      "Tous les documents de la session ont été supprimés."
    );
  });

  it("supprime un document en uploaded (row + objet)", async () => {
    h.db.documents = [h.documentRow({ state: "uploaded" })];
    await deleteImportDocument(h.DOC);
    expect(h.db.documents).toHaveLength(0);
    expect(h.storageCalls).toHaveLength(1);
  });

  it("échec Storage → la row est restaurée (compensation) et l'erreur est retournée", async () => {
    h.db.removeError = "storage down";
    await expect(deleteImportDocument(h.DOC)).rejects.toThrow(
      "document restauré, suppression à rejouer"
    );
    expect(h.storageCalls).toHaveLength(1);
    expect(h.db.documents).toHaveLength(1);
    expect(h.db.documents[0].id).toBe(h.DOC);
    expect(h.db.documents[0].state).toBe("uploading");
    expect(h.db.documents[0].storage_path).toBe(expectedPath);
  });

  it("échec PostgreSQL → aucun appel Storage (objet intact, rien à compenser)", async () => {
    h.db.deleteError = "db down";
    await expect(deleteImportDocument(h.DOC)).rejects.toThrow(
      "Erreur suppression document: db down"
    );
    expect(h.storageCalls).toHaveLength(0);
    expect(h.db.documents).toHaveLength(1);
  });

  it("double panne (Storage + restauration) → erreur portant le chemin de nettoyage", async () => {
    h.db.removeError = "storage down";
    h.db.insertError = "db down";
    await expect(deleteImportDocument(h.DOC)).rejects.toThrow(
      `Objet Storage orphelin possible [${expectedPath}]`
    );
    expect(h.db.documents).toHaveLength(0);
  });

  it("chemin Storage ne correspondant pas au document → refus avant toute mutation", async () => {
    h.db.documents = [
      h.documentRow({
        storage_path: `organizations/${h.ORG}/imports/${h.SESSION}/documents/44444444-4444-4444-4444-444444444444/stock.pdf`,
      }),
    ];
    await expect(deleteImportDocument(h.DOC)).rejects.toThrow(
      "Chemin Storage du document invalide"
    );
    expect(h.db.documents).toHaveLength(1);
    expect(h.storageCalls).toHaveLength(0);
  });

  it("refuse la suppression hors des états sûrs (aucun appel Storage)", async () => {
    h.db.documents = [h.documentRow({ state: "parsed" })];
    await expect(deleteImportDocument(h.DOC)).rejects.toThrow(
      "Suppression non autorisée pour cet état du document"
    );
    expect(h.db.documents).toHaveLength(1);
    expect(h.storageCalls).toHaveLength(0);
  });

  it("rejette un document introuvable", async () => {
    h.db.documents = [];
    await expect(deleteImportDocument(h.DOC)).rejects.toThrow(
      "Document d'import introuvable"
    );
    expect(h.storageCalls).toHaveLength(0);
  });

  it("rejette un rôle hors owner/manager avant toute mutation", async () => {
    h.db.roles[h.ORG] = "seller";
    await expect(deleteImportDocument(h.DOC)).rejects.toThrow(
      "Seuls les propriétaires et managers peuvent gérer les imports"
    );
    expect(h.db.documents).toHaveLength(1);
    expect(h.storageCalls).toHaveLength(0);
  });

  it("rejette un utilisateur non authentifié", async () => {
    h.db.user = null;
    await expect(deleteImportDocument(h.DOC)).rejects.toThrow("Non authentifié");
    expect(h.storageCalls).toHaveLength(0);
  });
});

describe("startImportProcessing — lots partiellement en échec", () => {
  beforeEach(() => {
    h.db.sessions = [h.sessionRow({ state: "collecting" })];
    h.db.documents = [
      h.documentRow({ id: h.DOC, state: "uploaded" }),
      h.documentRow({
        id: "77777777-7777-4777-8777-777777777777",
        original_name: "page2.png",
        state: "failed",
      }),
    ];
  });

  it("autorise le traitement des documents uploaded malgré un échec dans le même lot", async () => {
    const session = await startImportProcessing(h.SESSION);
    expect(session.state).toBe("processing");
    expect(h.db.sessions[0].state).toBe("processing");
  });

  it("refuse uniquement lorsqu'aucun document n'est prêt", async () => {
    h.db.documents = [
      h.documentRow({ id: h.DOC, state: "failed" }),
    ];

    await expect(startImportProcessing(h.SESSION)).rejects.toThrow(
      "Aucun document prêt à traiter"
    );
    expect(h.db.sessions[0].state).toBe("collecting");
  });
});

describe("materializeImportDocument — parsing durable", () => {
  const structuredSuccess = {
    status: "SUCCESS",
    documentId: h.DOC,
    sourceKind: "pdf",
    source: "pdf-local",
    pages: [
      { page: 1, text: "Produit Test" },
      { page: 2, text: "Suite Produit Test" },
    ],
    candidates: [],
    warnings: [],
    errors: [],
  };

  beforeEach(() => {
    h.db.sessions = [h.sessionRow({ state: "processing" })];
    h.db.documents = [h.documentRow({ state: "uploaded" })];
  });

  it("persiste l'artefact local avant la structuration IA", async () => {
    h.db.extractionQueue = [
      {
        local: {
          status: "READY",
          artifact: {
            version: 1,
            source: "pdf-local",
            pages: [
              { page: 1, text: "Produit A 10 000 FCFA" },
              { page: 2, text: "Client A" },
            ],
            warnings: [],
          },
        },
      },
      { structured: structuredSuccess },
    ];

    await materializeImportDocument(h.DOC);

    expect(h.db.documents[0].state).toBe("extracted");
    expect(h.db.documents[0].parsed_at).toBeTruthy();
    expect(h.db.documents[0].parsed_artifact).toEqual({
      version: 1,
      source: "pdf-local",
      pages: [
        { page: 1, text: "Produit A 10 000 FCFA" },
        { page: 2, text: "Client A" },
      ],
      warnings: [],
    });
    expect(h.db.documents[0].page_count).toBe(2);
  });

  it("panne IA après parsing laisse parsed avec artefact durable", async () => {
    h.db.extractionQueue = [
      {
        local: {
          status: "READY",
          artifact: {
            version: 1,
            source: "pdf-local",
            pages: [{ page: 1, text: "Produit B 20 000 FCFA" }],
            warnings: [],
          },
        },
      },
      {
        structured: {
          status: "PARTIAL",
          documentId: h.DOC,
          sourceKind: "pdf",
          source: "pdf-local",
          pages: [{ page: 1, text: "Produit B 20 000 FCFA" }],
          candidates: [],
          warnings: [],
          errors: [{ code: "PROVIDER_ERROR", message: "Gemini 503" }],
        },
      },
    ];

    await expect(materializeImportDocument(h.DOC)).rejects.toThrow("Gemini 503");

    expect(h.db.documents[0].state).toBe("parsed");
    expect(h.db.documents[0].parsed_artifact).toEqual({
      version: 1,
      source: "pdf-local",
      pages: [{ page: 1, text: "Produit B 20 000 FCFA" }],
      warnings: [],
    });
  });

  it("reprise depuis parsed réutilise l'artefact sans relecture locale", async () => {
    h.db.documents = [h.documentRow({
      state: "parsed",
      parsed_artifact: {
        version: 1,
        source: "pdf-local",
        pages: [{ page: 1, text: "Produit C 30 000 FCFA" }],
        warnings: [],
      },
      parsed_at: "2026-10-05T19:00:00+00:00",
      page_count: 1,
    })];
    h.db.extractionQueue = [{ structured: structuredSuccess }];

    const before = JSON.stringify(h.db.documents[0].parsed_artifact);
    await materializeImportDocument(h.DOC);

    expect(JSON.stringify(h.db.documents[0].parsed_artifact)).toBe(before);
    expect(h.db.documents[0].state).toBe("extracted");
  });

  it("document parsed ancien sans artefact est auto-rattrapé une seule fois", async () => {
    h.db.documents = [h.documentRow({
      state: "parsed",
      parsed_artifact: null,
    })];
    h.db.extractionQueue = [
      {
        local: {
          status: "READY",
          artifact: {
            version: 1,
            source: "pdf-local",
            pages: [{ page: 1, text: "Ancien document" }],
            warnings: [],
          },
        },
      },
      { structured: structuredSuccess },
    ];

    await materializeImportDocument(h.DOC);

    expect(h.db.documents[0].parsed_artifact).toEqual({
      version: 1,
      source: "pdf-local",
      pages: [{ page: 1, text: "Ancien document" }],
      warnings: [],
    });
    expect(h.db.documents[0].state).toBe("extracted");
  });

  it("échec de lecture locale reste failed et n'invente pas d'artefact", async () => {
    h.db.extractionQueue = [{
      local: {
        status: "FAILED",
        source: "pdf-local",
        pages: [],
        warnings: [],
        errors: [{ code: "UNREADABLE_DOCUMENT", message: "Document illisible" }],
      },
    }];

    await expect(materializeImportDocument(h.DOC)).rejects.toThrow(
      "Document illisible"
    );
    expect(h.db.documents[0].state).toBe("failed");
    expect(h.db.documents[0].parsed_artifact).toBeNull();
  });

  it("panne RPC après extraction libère le document vers parsed en conservant l'artefact", async () => {
    h.db.rpcMaterializeError = "RPC indisponible";
    h.db.extractionQueue = [{ structured: structuredSuccess }];

    h.db.documents = [h.documentRow({
      state: "parsed",
      parsed_artifact: {
        version: 1,
        source: "pdf-local",
        pages: [{ page: 1, text: "Produit D" }],
        warnings: [],
      },
    })];

    await expect(materializeImportDocument(h.DOC)).rejects.toThrow("RPC indisponible");
    expect(h.db.documents[0].state).toBe("parsed");
    expect(h.db.documents[0].parsed_artifact).toBeTruthy();
  });
});


describe("review item edit/delete", () => {
  const ITEM = "44444444-4444-4444-8444-444444444444";
  const EXISTING = {
    name: {
      raw: "Huile",
      normalized: "Huile",
      confidence: "high",
    },
    sale_price: {
      raw: "45 000 FCFA",
      normalized: 45000,
      confidence: "high",
    },
  };

  beforeEach(() => {
    h.db.sessions = [h.sessionRow({ state: "needs_review" })];
    h.db.items = [{
      id: ITEM,
      session_id: h.SESSION,
      document_id: h.DOC,
      organization_id: h.ORG,
      entity_type: "product",
      source_page: 1,
      fields: EXISTING,
      match: {
        existing_id: "55555555-5555-4555-8555-555555555555",
        existing_name: "Huile",
        score: 0.91,
      },
      action: "update",
      status: "validated",
      error_message: null,
      created_at: "2026-09-29T00:00:00+00:00",
      updated_at: "2026-09-29T00:00:00+00:00",
    }];
  });

  it("permet de corriger un champ et d'en ajouter un absent", async () => {
    const updated = await updateImportItemFields({
      id: ITEM,
      values: {
        name: "Huile végétale 1 L",
        sale_price: "50 000 FCFA",
        unit: "bouteille",
        stock_quantity: "24",
      },
    });

    expect(updated.fields.name.raw).toBe("Huile végétale 1 L");
    expect(updated.fields.sale_price.normalized).toBe(50000);
    expect(updated.fields.unit.normalized).toBe("bouteille");
    expect(updated.fields.stock_quantity.normalized).toBe(24);
    expect(updated.match).toBeNull();
    expect(updated.action).toBe("create");
    expect(updated.status).toBe("pending");
  });

  it("refuse une modification hors revue", async () => {
    h.db.sessions = [h.sessionRow({ state: "ready" })];

    await expect(
      updateImportItemFields({
        id: ITEM,
        values: { name: "Autre nom" },
      })
    ).rejects.toThrow("Modification autorisée uniquement pendant la revue");
  });

  it("permet de supprimer un élément pendant la revue sans supprimer le document", async () => {
    await deleteImportItem(ITEM);

    expect(h.db.items).toHaveLength(0);
    expect(h.db.documents).toHaveLength(0);
  });

  it("refuse la suppression hors revue", async () => {
    h.db.sessions = [h.sessionRow({ state: "ready" })];

    await expect(deleteImportItem(ITEM)).rejects.toThrow(
      "Suppression d'un élément autorisée uniquement pendant la revue"
    );
    expect(h.db.items).toHaveLength(1);
  });

  it("n'ecrase pas une modification concurrente pendant l'édition d'un item", async () => {
    h.db.mutationRace = () => {
      h.db.items[0].status = "ignored";
    };

    await expect(
      updateImportItemFields({
        id: ITEM,
        values: { name: "Nom concurrent" },
      })
    ).rejects.toThrow();

    expect(h.db.items[0].status).toBe("ignored");
    const fields = h.db.items[0].fields as { name: { raw: string } };
    expect(fields.name.raw).toBe("Huile");
  });

  it("n'ecrase pas un item modifié concurrentement à statut identique", async () => {
    h.db.mutationRace = () => {
      const fields = h.db.items[0].fields as { name: { raw: string } };
      fields.name.raw = "Nom concurrent";
      h.db.items[0].updated_at = "2026-10-06T00:01:00+00:00";
    };

    await expect(
      updateImportItemFields({
        id: ITEM,
        values: { name: "Nom serveur" },
      })
    ).rejects.toThrow("Item modifié en parallèle");

    const fields = h.db.items[0].fields as { name: { raw: string } };
    expect(fields.name.raw).toBe("Nom concurrent");
    expect(h.db.items[0].updated_at).toBe("2026-10-06T00:01:00+00:00");
  });

  it("n'efface pas un item modifié concurrentement à statut identique", async () => {
    h.db.mutationRace = () => {
      h.db.items[0].updated_at = "2026-10-06T00:02:00+00:00";
    };

    await expect(deleteImportItem(ITEM)).rejects.toThrow(
      "Item modifié en parallèle"
    );

    expect(h.db.items).toHaveLength(1);
    expect(h.db.items[0].status).toBe("validated");
    expect(h.db.items[0].updated_at).toBe("2026-10-06T00:02:00+00:00");
  });
});

describe("getImportDocuments", () => {
  it("retourne les documents de la session", async () => {
    h.db.documents = [h.documentRow(), h.documentRow({ id: h.DOC })];
    const rows = await getImportDocuments(h.SESSION);
    expect(rows).toHaveLength(2);
  });

  it("exclut les documents d'une autre session (aucun rattachement transversal)", async () => {
    h.db.documents = [
      h.documentRow(),
      h.documentRow({
        id: "77777777-7777-4777-8777-777777777777",
        session_id: "88888888-8888-4888-8888-888888888888",
      }),
    ];
    const rows = await getImportDocuments(h.SESSION);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(h.DOC);
  });

  it("rejette un utilisateur non authentifié", async () => {
    h.db.user = null;
    await expect(getImportDocuments(h.SESSION)).rejects.toThrow("Non authentifié");
  });
});

describe("cancelImportSession", () => {
  beforeEach(() => {
    h.db.sessions = [h.sessionRow()];
  });

  it("annule une session en collecting (état Phase 1)", async () => {
    const row = await cancelImportSession(h.SESSION);
    expect(row.state).toBe("cancelled");
  });

  it("refuse l'annulation d'une session terminée", async () => {
    h.db.sessions = [h.sessionRow({ state: "completed" })];
    await expect(cancelImportSession(h.SESSION)).rejects.toThrow(
      "Transition d'état non autorisée"
    );
    expect(h.db.sessions[0].state).toBe("completed");
  });

  it("n'annule pas une session dont l'état a changé concurrentement", async () => {
    h.db.mutationRace = () => {
      h.db.sessions[0].state = "processing";
    };

    await expect(cancelImportSession(h.SESSION)).rejects.toThrow();

    expect(h.db.sessions[0].state).toBe("processing");
  });

  it("n'annule pas une session modifiée concurrentement à état identique", async () => {
    h.db.mutationRace = () => {
      h.db.sessions[0].updated_at = "2026-10-06T00:03:00+00:00";
    };

    await expect(cancelImportSession(h.SESSION)).rejects.toThrow(
      "Session modifiée en parallèle"
    );

    expect(h.db.sessions[0].state).toBe("collecting");
    expect(h.db.sessions[0].updated_at).toBe("2026-10-06T00:03:00+00:00");
  });

  it("rejette un rôle hors owner/manager", async () => {
    h.db.roles[h.ORG] = "seller";
    await expect(cancelImportSession(h.SESSION)).rejects.toThrow(
      "Seuls les propriétaires et managers peuvent gérer les imports"
    );
  });
});
