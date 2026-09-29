import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Fake storage : capture les appels supabase.storage.from("imports").*
// ---------------------------------------------------------------------------

const fake = vi.hoisted(() => {
  const calls = {
    upload: [] as Array<{
      bucket: string;
      path: string;
      file: unknown;
      opts: Record<string, unknown>;
    }>,
    remove: [] as Array<{ bucket: string; paths: string[] }>,
  };
  const state = {
    uploadError: null as string | null,
    removeError: null as string | null,
  };

  const storage = {
    from(bucket: string) {
      return {
        async upload(path: string, file: unknown, opts: Record<string, unknown>) {
          calls.upload.push({ bucket, path, file, opts });
          return { error: state.uploadError ? { message: state.uploadError } : null };
        },
        async remove(paths: string[]) {
          calls.remove.push({ bucket, paths });
          return { error: state.removeError ? { message: state.removeError } : null };
        },
      };
    },
  };

  function reset() {
    calls.upload.length = 0;
    calls.remove.length = 0;
    state.uploadError = null;
    state.removeError = null;
  }

  return { calls, state, storage, reset };
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: fake.storage }),
}));

import { buildImportStoragePath } from "./schemas";
import { deleteImportStorageObject, uploadImportDocument } from "./storage-client";

const ORG = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const DOC = "33333333-3333-4333-8333-333333333333";

function makeFile(name: string, type: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

beforeEach(() => {
  fake.reset();
});

describe("uploadImportDocument", () => {
  const validPath = buildImportStoragePath(ORG, SESSION, DOC, "stock.pdf");

  it("uploade vers le chemin exact du bucket imports (jamais d'upsert)", async () => {
    const file = makeFile("stock.pdf", "application/pdf", 1024);
    await uploadImportDocument(file, validPath);
    expect(fake.calls.upload).toHaveLength(1);
    expect(fake.calls.upload[0].bucket).toBe("imports");
    expect(fake.calls.upload[0].path).toBe(validPath);
    expect(fake.calls.upload[0].opts).toMatchObject({
      contentType: "application/pdf",
      upsert: false,
    });
  });

  it("refuse un chemin Storage invalide avant tout appel (aucun objet orphelin)", async () => {
    const file = makeFile("stock.pdf", "application/pdf", 1024);
    await expect(
      uploadImportDocument(file, "imports/stock.pdf")
    ).rejects.toThrow(/Chemin de stockage invalide/);
    expect(fake.calls.upload).toHaveLength(0);
  });

  it("refuse un fichier au-delà de 25 Mo avant tout appel (aucun objet orphelin)", async () => {
    const file = makeFile("gros.pdf", "application/pdf", 25 * 1024 * 1024 + 1);
    await expect(uploadImportDocument(file, validPath)).rejects.toThrow(
      /25 Mo/
    );
    expect(fake.calls.upload).toHaveLength(0);
  });

  it("propage une erreur d'upload avec le préfixe français", async () => {
    fake.state.uploadError = "quota";
    const file = makeFile("stock.pdf", "application/pdf", 1024);
    await expect(uploadImportDocument(file, validPath)).rejects.toThrow(
      "Erreur upload document: quota"
    );
  });
});

describe("deleteImportStorageObject", () => {
  const validPath = buildImportStoragePath(ORG, SESSION, DOC, "stock.pdf");

  it("supprime l'objet exact du bucket imports", async () => {
    await deleteImportStorageObject(validPath);
    expect(fake.calls.remove).toHaveLength(1);
    expect(fake.calls.remove[0]).toEqual({
      bucket: "imports",
      paths: [validPath],
    });
  });

  it("refuse un chemin Storage invalide avant tout appel", async () => {
    await expect(deleteImportStorageObject("../secret")).rejects.toThrow(
      /Chemin de stockage invalide/
    );
    expect(fake.calls.remove).toHaveLength(0);
  });

  it("propage une erreur de suppression avec le préfixe français", async () => {
    fake.state.removeError = "locked";
    await expect(deleteImportStorageObject(validPath)).rejects.toThrow(
      "Erreur suppression document: locked"
    );
  });
});
