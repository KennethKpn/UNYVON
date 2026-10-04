import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "55555555-5555-4555-8555-555555555555";
const ORG = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const ITEM = "77777777-7777-4777-8777-777777777777";

const state = vi.hoisted(() => ({
  user: { id: "55555555-5555-4555-8555-555555555555" } as { id: string } | null,
  role: "owner" as string | null,
  session: {
    id: "22222222-2222-4222-8222-222222222222",
    organization_id: "11111111-1111-4111-8111-111111111111",
    state: "needs_review",
  },
  item: {
    id: "77777777-7777-4777-8777-777777777777",
    session_id: "22222222-2222-4222-8222-222222222222",
    document_id: "33333333-3333-4333-8333-333333333333",
    organization_id: "11111111-1111-4111-8111-111111111111",
    entity_type: "product",
    source_page: 1,
    fields: {
      name: { raw: "Produit A", normalized: "produit a", confidence: "high", page: 1 },
      sale_price: { raw: "10000", normalized: 10000, confidence: "high", page: 1 },
    },
    match: null,
    action: "create",
    status: "pending",
    error_message: null,
  },
}));

function builder(table: string) {
  const filters: Array<[string, unknown]> = [];
  let operation: "select" | "update" | "delete" = "select";
  let payload: Record<string, unknown> | null = null;

  const api = {
    select() { return api; },
    eq(column: string, value: unknown) { filters.push([column, value]); return api; },
    limit() { return api; },
    maybeSingle() {
      if (table === "import_items" && state.item && filters.some(([c, v]) => c === "id" && v === ITEM)) {
        return Promise.resolve({ data: state.item, error: null });
      }
      if (table === "import_sessions" && filters.some(([c, v]) => c === "id" && v === SESSION)) {
        return Promise.resolve({ data: state.session, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    update(next: Record<string, unknown>) {
      operation = "update"; payload = next; return api;
    },
    delete() { operation = "delete"; return api; },
    single() {
      if (operation === "update" && table === "import_items") {
        Object.assign(state.item, payload);
        return Promise.resolve({ data: state.item, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    then(resolve: (value: unknown) => unknown) {
      if (operation === "delete" && table === "import_items") {
        state.item = null as never;
        return Promise.resolve(resolve({ data: null, error: null }));
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

import {
  deleteImportItem,
  updateImportItemFields,
} from "./import-actions";

beforeEach(() => {
  state.user = { id: USER };
  state.role = "owner";
  state.session.state = "needs_review";
  state.item = {
    id: ITEM,
    session_id: SESSION,
    document_id: "33333333-3333-4333-8333-333333333333",
    organization_id: ORG,
    entity_type: "product",
    source_page: 1,
    fields: {
      name: { raw: "Produit A", normalized: "produit a", confidence: "high", page: 1 },
      sale_price: { raw: "10000", normalized: 10000, confidence: "high", page: 1 },
    },
    match: null,
    action: "create",
    status: "pending",
    error_message: null,
  };
});

describe("review item editing", () => {
  it("modifie les valeurs et force une nouvelle validation", async () => {
    const updated = await updateImportItemFields({
      id: ITEM,
      values: { name: "Produit B", sale_price: "12500" },
    });

    expect(updated.fields.name.raw).toBe("Produit B");
    expect(updated.fields.sale_price.raw).toBe("12500");
    expect(updated.fields.sale_price.normalized).toBeUndefined();
    expect(updated.fields.sale_price.warning).toContain("Modifié manuellement");
    expect(updated.status).toBe("pending");
    expect(updated.action).toBe("create");
    expect(updated.match).toBeNull();
  });

  it("refuse une modification hors revue", async () => {
    state.session.state = "processing";
    await expect(updateImportItemFields({ id: ITEM, values: { name: "X" } }))
      .rejects.toThrow("Modification autorisée uniquement pendant la revue");
  });
});

describe("review item deletion", () => {
  it("supprime uniquement l'élément extrait", async () => {
    await deleteImportItem(ITEM);
    expect(state.item).toBeNull();
  });

  it("refuse un élément déjà importé", async () => {
    state.item.status = "imported";
    await expect(deleteImportItem(ITEM))
      .rejects.toThrow("Un item déjà importé ne peut plus être supprimé");
  });
});
