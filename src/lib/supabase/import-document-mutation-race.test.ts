import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "55555555-5555-4555-8555-555555555555";
const ORG = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const DOC = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
  user: { id: "55555555-5555-4555-8555-555555555555" } as { id: string } | null,
  role: "owner" as string | null,
  documentState: "failed" as string,
  updatePayload: null as Record<string, unknown> | null,
  updateFilters: [] as Array<[string, unknown]>,
  deleteFilters: [] as Array<[string, unknown]>,
  beforeMutation: null as (() => void) | null,
  storageRemoved: false,
}));

function reset() {
  state.user = { id: USER };
  state.role = "owner";
  state.documentState = "failed";
  state.updatePayload = null;
  state.updateFilters = [];
  state.deleteFilters = [];
  state.beforeMutation = null;
  state.storageRemoved = false;
}

function documentRow() {
  return {
    id: DOC,
    session_id: SESSION,
    organization_id: ORG,
    original_name: "scan.pdf",
    source_kind: "pdf",
    mime_type: "application/pdf",
    size_bytes: 1024,
    storage_path: `organizations/${ORG}/imports/${SESSION}/documents/${DOC}/scan.pdf`,
    state: state.documentState,
    page_count: null,
    parsed_artifact: null,
    parsed_at: null,
    processed_at: null,
    error_message: null,
  };
}

function builder(table: string) {
  const filters: Array<[string, unknown]> = [];
  let operation: "select" | "update" | "delete" = "select";
  let payload: Record<string, unknown> | null = null;

  const api = {
    select() { return api; },
    eq(column: string, value: unknown) { filters.push([column, value]); return api; },
    limit() { return api; },
    order() { return api; },
    update(next: Record<string, unknown>) {
      operation = "update";
      payload = next;
      state.updatePayload = next;
      state.updateFilters = filters;
      return api;
    },
    delete() {
      operation = "delete";
      state.deleteFilters = filters;
      return api;
    },
    maybeSingle() {
      if (operation === "delete" && table === "import_documents") {
        state.beforeMutation?.();
        state.beforeMutation = null;
        const id = filters.find(([column]) => column === "id")?.[1];
        const expectedState = filters.find(([column]) => column === "state")?.[1];
        const matches = id === DOC && expectedState === state.documentState;
        if (!matches) return Promise.resolve({ data: null, error: null });
        state.documentState = "deleted";
        state.storageRemoved = true;
        return Promise.resolve({ data: { id: DOC }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    single() {
      if (operation === "update" && table === "import_documents") {
        state.beforeMutation?.();
        state.beforeMutation = null;
        const id = filters.find(([column]) => column === "id")?.[1];
        const expectedState = filters.find(([column]) => column === "state")?.[1];
        const matches = id === DOC && expectedState === state.documentState;
        if (!matches) {
          return Promise.resolve({
            data: null,
            error: { message: "aucune ligne mise à jour" },
          });
        }
        state.documentState = String(payload?.state);
        return Promise.resolve({ data: documentRow(), error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    then(resolve: (value: unknown) => unknown) {
      if (table === "import_documents" && operation === "select") {
        return Promise.resolve(resolve({
          data: [documentRow()],
          error: null,
        }));
      }
      if (table === "import_sessions" && operation === "select") {
        return Promise.resolve(resolve({
          data: [{
            id: SESSION,
            organization_id: ORG,
            state: "processing",
          }],
          error: null,
        }));
      }
      return Promise.resolve(resolve({ data: [], error: null }));
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
      list: async () => ({
        data: [{
          id: "object-1",
          name: "scan.pdf",
        }],
        error: null,
      }),
      remove: async () => {
        state.storageRemoved = true;
        return { data: null, error: null };
      },
    }),
  },
};

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => supabase,
}));

import {
  deleteImportDocument,
  markImportDocumentUploadFailed,
  markImportDocumentUploaded,
} from "./import-actions";

beforeEach(reset);

describe("document mutation compare-and-swap", () => {
  it("refuse de marquer uploaded si l'état change après la lecture", async () => {
    state.documentState = "uploading";
    state.beforeMutation = () => {
      state.documentState = "failed";
    };

    await expect(markImportDocumentUploaded(DOC)).rejects.toThrow(
      "aucune ligne mise à jour"
    );
    expect(state.documentState).toBe("failed");
  });

  it("refuse de marquer failed si l'état change après la lecture", async () => {
    state.documentState = "uploading";
    state.beforeMutation = () => {
      state.documentState = "uploaded";
    };

    await expect(markImportDocumentUploadFailed(DOC, "upload error")).rejects.toThrow(
      "aucune ligne mise à jour"
    );
    expect(state.documentState).toBe("uploaded");
  });

  it("ne supprime pas le document si une reprise le modifie après la lecture", async () => {
    state.documentState = "failed";
    state.beforeMutation = () => {
      state.documentState = "uploading";
    };

    await expect(deleteImportDocument(DOC)).rejects.toThrow(
      "Document modifié en parallèle"
    );
    expect(state.documentState).toBe("uploading");
    expect(state.storageRemoved).toBe(false);
  });
});
