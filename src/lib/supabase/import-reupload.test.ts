import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "55555555-5555-4555-8555-555555555555";
const ORG = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const DOC = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => {
  const user = "55555555-5555-4555-8555-555555555555";
  return {
  user: { id: user } as { id: string } | null,
  role: "owner" as string | null,
  updateError: null as string | null,
  storageError: null as string | null,
  documents: [] as Array<Record<string, unknown>>,
  storageObjects: [] as string[],
  storageLists: [] as Array<{ folder: string; search?: string }>,
  updates: [] as Array<Record<string, unknown>>,
  };
});

function reset() {
  state.user = { id: USER };
  state.role = "owner";
  state.updateError = null;
  state.storageError = null;
  state.storageObjects = [];
  state.storageLists = [];
  state.updates = [];
  state.documents = [{
    id: DOC,
    session_id: SESSION,
    organization_id: ORG,
    original_name: "scan.pdf",
    source_kind: "pdf",
    mime_type: "application/pdf",
    size_bytes: 1024,
    storage_path: `organizations/${ORG}/imports/${SESSION}/documents/${DOC}/scan.pdf`,
    state: "failed",
    page_count: 3,
    parsed_artifact: {
      version: 1,
      source: "pdf-local",
      pages: [{ page: 1, text: "ancien" }],
      warnings: [],
    },
    parsed_at: "2026-10-05T20:00:00+00:00",
    processed_at: null,
    error_message: "Objet perdu",
    updated_at: "2026-10-05T20:00:00+00:00",
    created_at: "2026-10-05T19:00:00+00:00",
  }];
}

function builder(table: string) {
  const filters: Array<[string, unknown]> = [];
  let operation: "select" | "update" = "select";
  let payload: Record<string, unknown> | null = null;

  const api = {
    select() { return api; },
    eq(column: string, value: unknown) { filters.push([column, value]); return api; },
    limit() { return api; },
    maybeSingle() {
      if (table !== "import_documents") return Promise.resolve({ data: null, error: null });
      const row = state.documents.find((candidate) =>
        filters.every(([column, value]) => candidate[column] === value)
      );
      return Promise.resolve({ data: row ?? null, error: null });
    },
    update(next: Record<string, unknown>) {
      operation = "update";
      payload = next;
      return api;
    },
    single() {
      if (operation !== "update" || table !== "import_documents") {
        return Promise.resolve({ data: null, error: null });
      }
      if (state.updateError) {
        return Promise.resolve({ data: null, error: { message: state.updateError } });
      }
      const row = state.documents.find((candidate) =>
        filters.every(([column, value]) => candidate[column] === value)
      );
      if (!row) return Promise.resolve({ data: null, error: { message: "no row" } });
      Object.assign(row, payload);
      state.updates.push({ ...(payload ?? {}) });
      return Promise.resolve({ data: row, error: null });
    },
  };

  return api;
}

const supabase = {
  auth: {
    getUser: async () => ({ data: { user: state.user }, error: null }),
  },
  rpc: async (name: string) => {
    if (name === "current_org_role") return { data: state.role, error: null };
    return { data: null, error: null };
  },
  from: (table: string) => builder(table),
  storage: {
    from: () => ({
      list: async (folder: string, options?: { search?: string }) => {
        state.storageLists.push({ folder, ...options });
        if (state.storageError) {
          return { data: null, error: { message: state.storageError } };
        }
        const prefix = `${folder}/`;
        return {
          data: state.storageObjects
            .filter((path) => path.startsWith(prefix))
            .filter((path) => !path.slice(prefix.length).includes("/"))
            .filter((path) =>
              options?.search === undefined ||
              path.slice(prefix.length).startsWith(options.search)
            )
            .map((path) => ({ id: `obj-${path.length}`, name: path.slice(prefix.length) })),
          error: null,
        };
      },
    }),
  },
};

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => supabase,
}));

import { prepareImportDocumentReupload } from "./import-review-actions";

beforeEach(reset);

describe("prepareImportDocumentReupload", () => {
  it("prépare un nouveau fichier quand l'objet Storage est réellement absent", async () => {
    const result = await prepareImportDocumentReupload({
      documentId: DOC,
      originalName: "scan-corrige.pdf",
      sourceKind: "pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
    });

    expect(result.document.state).toBe("uploading");
    expect(result.document.original_name).toBe("scan-corrige.pdf");
    expect(result.storagePath).toContain(`/documents/${DOC}/scan-corrige.pdf`);
    expect(result.document.storage_path).toBe(result.storagePath);
    expect(result.document.page_count).toBeNull();
    expect(result.document.parsed_artifact).toBeNull();
    expect(result.document.parsed_at).toBeNull();
    expect(result.document.error_message).toBeNull();
    expect(state.updates).toHaveLength(1);
  });

  it("refuse de préparer un réupload si l'ancien objet est encore présent", async () => {
    state.storageObjects = [state.documents[0].storage_path as string];

    await expect(
      prepareImportDocumentReupload({
        documentId: DOC,
        originalName: "scan-corrige.pdf",
        sourceKind: "pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
      })
    ).rejects.toThrow("Objet Storage encore présent");
    expect(state.updates).toHaveLength(0);
    expect(state.documents[0].state).toBe("failed");
  });

  it("valide le contrat fichier avant de muter la row", async () => {
    await expect(
      prepareImportDocumentReupload({
        documentId: DOC,
        originalName: "scan.pdf.exe",
        sourceKind: "pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
      })
    ).rejects.toThrow(/supporté|MIME|extension/i);
    expect(state.updates).toHaveLength(0);
  });

  it("refuse une préparation depuis un état autre que failed", async () => {
    state.documents[0].state = "uploaded";

    await expect(
      prepareImportDocumentReupload({
        documentId: DOC,
        originalName: "scan-corrige.pdf",
        sourceKind: "pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
      })
    ).rejects.toThrow("Réupload autorisé uniquement depuis l'état 'failed'");
    expect(state.updates).toHaveLength(0);
    expect(state.storageLists).toHaveLength(0);
  });

  it("refuse un utilisateur non authentifié", async () => {
    state.user = null;

    await expect(
      prepareImportDocumentReupload({
        documentId: DOC,
        originalName: "scan-corrige.pdf",
        sourceKind: "pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
      })
    ).rejects.toThrow("Non authentifié");
    expect(state.updates).toHaveLength(0);
  });
});
