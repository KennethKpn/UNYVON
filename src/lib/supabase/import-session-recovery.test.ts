import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "55555555-5555-4555-8555-555555555555";
const ORG = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  user: { id: "55555555-5555-4555-8555-555555555555" } as { id: string } | null,
  role: "owner" as string | null,
  sessionState: "failed" as string,
  documents: [] as Array<Record<string, unknown>>,
  updateError: null as string | null,
  updates: [] as Array<Record<string, unknown>>,
}));

function reset() {
  state.user = { id: USER };
  state.role = "owner";
  state.sessionState = "failed";
  state.documents = [];
  state.updateError = null;
  state.updates = [];
}

function builder(table: string) {
  const filters: Array<[string, unknown]> = [];
  let operation: "select" | "update" = "select";
  let payload: Record<string, unknown> | null = null;

  const api = {
    select() { return api; },
    eq(column: string, value: unknown) { filters.push([column, value]); return api; },
    limit() { return api; },
    update(next: Record<string, unknown>) {
      operation = "update";
      payload = next;
      return api;
    },
    single() {
      if (operation === "update" && table === "import_sessions") {
        if (state.updateError) {
          return Promise.resolve({ data: null, error: { message: state.updateError } });
        }
        const stateFilter = filters.find(([column]) => column === "state")?.[1];
        if (state.sessionState !== stateFilter) {
          return Promise.resolve({ data: null, error: { message: "no row" } });
        }
        state.sessionState = String(payload?.state);
        state.updates.push({ ...(payload ?? {}) });
        return Promise.resolve({
          data: {
            id: SESSION,
            organization_id: ORG,
            state: state.sessionState,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    then(resolve: (value: unknown) => unknown) {
      if (table === "import_sessions" && operation === "select") {
        return Promise.resolve(resolve({
          data: [{
            id: SESSION,
            organization_id: ORG,
            state: state.sessionState,
          }],
          error: null,
        }));
      }
      if (table === "import_documents" && operation === "select") {
        return Promise.resolve(resolve({ data: state.documents, error: null }));
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
};

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => supabase,
}));

import { reopenFailedImportSession } from "./import-actions";

beforeEach(reset);

describe("reopenFailedImportSession", () => {
  it("réouvre une session failed sans aucun document", async () => {
    const session = await reopenFailedImportSession(SESSION);

    expect(session.state).toBe("collecting");
    expect(state.sessionState).toBe("collecting");
    expect(state.updates).toEqual([{ state: "collecting", error_message: null }]);
  });

  it("refuse une session failed qui contient encore un document", async () => {
    state.documents = [{ id: "33333333-3333-4333-8333-333333333333" }];

    await expect(reopenFailedImportSession(SESSION)).rejects.toThrow(
      "contient encore un document"
    );
    expect(state.sessionState).toBe("failed");
    expect(state.updates).toHaveLength(0);
  });

  it("refuse toute autre phase", async () => {
    state.sessionState = "completed";

    await expect(reopenFailedImportSession(SESSION)).rejects.toThrow(
      "uniquement depuis l'état failed"
    );
    expect(state.updates).toHaveLength(0);
  });

  it("propage un échec de mise à jour concurrent", async () => {
    state.updateError = "conflit";

    await expect(reopenFailedImportSession(SESSION)).rejects.toThrow(
      "Réouverture concurrente ou impossible"
    );
    expect(state.updates).toHaveLength(0);
  });
});
