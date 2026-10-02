import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Verrouillage applicatif des policies Storage Smart Data Import.
// Sans base de donnees, on verrouille la DEFINITION EFFECTIVE : la derniere
// migration qui cree une policy est celle qui s'applique. Un retour en arriere
// (0011 modifie, 0012 retire, garde etat supprimee) fait echouer ces tests.
// Le comportement reel des policies est valide par supabase/verify-import-storage.sql
// (catalogue + RLS) et par test-storage-delete-runtime.js (suppression d'un objet
// via la Storage API, seul chemin autorise par Supabase sur storage.objects).
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

const INSERT_POLICY = "imports_insert_owner_manager";
const UPDATE_POLICY = "imports_update_owner_manager";
const DELETE_POLICY = "imports_delete_owner_manager";

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

function readMigration(file: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
}

function createStatements(sql: string, policy: string): Array<{
  file: string;
  body: string;
}> {
  const out: Array<{ file: string; body: string }> = [];
  const marker = `create policy "${policy}"`;
  let index = sql.indexOf(marker);
  while (index !== -1) {
    const next = sql.indexOf("create policy \"", index + marker.length);
    out.push({
      file: "",
      body: sql.slice(index, next === -1 ? sql.length : next),
    });
    index = sql.indexOf(marker, index + marker.length);
  }
  return out;
}

// Derniere definition = celle qui s'applique (drop + create dans 0012).
function effectivePolicy(policy: string): { file: string; body: string } {
  let found: { file: string; body: string } | null = null;
  for (const file of migrationFiles()) {
    for (const statement of createStatements(readMigration(file), policy)) {
      found = { file, body: statement.body };
    }
  }
  if (!found) throw new Error(`Policy ${policy} introuvable dans les migrations`);
  return found;
}

function importedPolicyNames(): Set<string> {
  const names = new Set<string>();
  for (const file of migrationFiles()) {
    const sql = readMigration(file);
    for (const match of sql.matchAll(/create policy "(imports_[a-z_]+)"/g)) {
      names.add(match[1]);
    }
  }
  return names;
}

describe("policies Storage imports (0011 + 0012)", () => {
  it("definit exactement les 4 policies imports_* (aucune ajoutee ni retiree)", () => {
    expect([...importedPolicyNames()].sort()).toEqual([
      "imports_delete_owner_manager",
      "imports_insert_owner_manager",
      "imports_select_owner_manager",
      "imports_update_owner_manager",
    ]);
  });

  it("INSERT effectif limite a l'etat 'uploading' du document", () => {
    const policy = effectivePolicy(INSERT_POLICY);
    expect(policy.file).toBe("0012_import_storage_integrity.sql");
    expect(policy.body).toContain("for insert");
    expect(policy.body).toContain("import_documents");
    expect(policy.body).toContain("d.state = 'uploading'");
    expect(policy.body).toContain("with check");
  });

  it("UPDATE effectif limite a l'etat 'uploading' du document", () => {
    const policy = effectivePolicy(UPDATE_POLICY);
    expect(policy.file).toBe("0012_import_storage_integrity.sql");
    expect(policy.body).toContain("for update");
    expect(policy.body).toContain("import_documents");
    expect(policy.body).toContain("d.state = 'uploading'");
  });

  it("DELETE effectif sans dependance a la row (voie Storage API)", () => {
    // deleteImportDocument() supprime la row PostgreSQL PUIS appelle la Storage
    // API (.remove([...])) : au moment ou l'objet part, la row n'existe plus.
    // Une exigence de row ici rendrait la suppression impossible et
    // garantirait un orphelin. Supabase interdisant le DELETE direct sur
    // storage.objects, ce controle structurel est le SEUL verificable en SQL ;
    // l'ordre row -> objet et l'absence d'orphelin sont valides par
    // test-storage-delete-runtime.js.
    const policy = effectivePolicy(DELETE_POLICY);
    expect(policy.body).toContain("for delete");
    expect(policy.body).not.toContain("import_documents");
    expect(policy.body).not.toContain("d.state");
  });

  it("DELETE effectif cible storage.objects pour le role authenticated", () => {
    const policy = effectivePolicy(DELETE_POLICY);
    expect(policy.body).toContain("on storage.objects for delete");
    expect(policy.body).toContain("to authenticated");
  });

  it("DELETE effectif limite au bucket imports et aux roles owner/manager", () => {
    const policy = effectivePolicy(DELETE_POLICY);
    expect(policy.body).toContain("bucket_id = 'imports'");
    expect(policy.body).toContain("in ('owner', 'manager')");
  });

  it("imports_delete_owner_manager n'est definie qu'une seule fois (0011)", () => {
    // Une redefinition ulterieure (0012+) modifierait silencieusement la
    // politique effective sans que les tests INSERT/UPDATE ne le voient.
    const definitions = migrationFiles().flatMap((file) =>
      createStatements(readMigration(file), DELETE_POLICY),
    );
    expect(definitions).toHaveLength(1);
    expect(effectivePolicy(DELETE_POLICY).file).toBe("0011_import.sql");
  });

  it("0012 remplace bien les deux policies (drop puis create, memes noms)", () => {
    const sql = readMigration("0012_import_storage_integrity.sql");
    const dropInsert = sql.indexOf(`drop policy "${INSERT_POLICY}"`);
    const createInsert = sql.indexOf(`create policy "${INSERT_POLICY}"`);
    const dropUpdate = sql.indexOf(`drop policy "${UPDATE_POLICY}"`);
    const createUpdate = sql.indexOf(`create policy "${UPDATE_POLICY}"`);
    expect(dropInsert).toBeGreaterThan(-1);
    expect(createInsert).toBeGreaterThan(dropInsert);
    expect(dropUpdate).toBeGreaterThan(-1);
    expect(createUpdate).toBeGreaterThan(dropUpdate);
  });
});
