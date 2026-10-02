import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Perimetre SQL de verify-import-storage.sql.
//
// Supabase interdit desormais le DELETE direct sur les tables Storage :
//   "Direct deletion from storage tables is not allowed. Use the Storage API
//    instead."
//
// Le script ne peut donc PLUS prouver le comportement de suppression d'un objet.
// Ce controle est delegue a la Storage API (.remove([...])) et verifie par le
// script runtime test-storage-delete-runtime.js, en contexte `authenticated`
// (service_role contournerait la RLS et ne prouverait rien).
//
// Ce bloc verrouille la frontiere : aucune ecriture destructive sur le schema
// `storage` ne doit reapparaitre dans le script SQL, tandis que les controles
// structurels de la policy DELETE — seule garantie restante cote SQL — doivent
// rester intacts et etre renforces.
// ---------------------------------------------------------------------------

const SUPABASE_DIR = path.join(process.cwd(), "supabase");

function readStorageVerifyScript(): string {
  return readFileSync(path.join(SUPABASE_DIR, "verify-import-storage.sql"), "utf8");
}

describe("verify-import-storage.sql — aucun DELETE direct sur le schema storage", () => {
  const sql = readStorageVerifyScript();

  it("ne contient aucun DELETE sur storage.objects", () => {
    // `\s+` absorbe un eventuel retour a la ligne entre DELETE et FROM.
    // C'est l'incompatibilite revelee au runtime Supabase : le script echouait
    // avant meme d'atteindre la section 2.
    expect(sql).not.toMatch(/delete\s+from\s+storage\s*\.\s*objects/i);
  });

  it("ne supprime rien dans le schema storage (aucune ecriture destructive)", () => {
    // Interdit aussi toute variante de contournement par une autre ecriture
    // destructive (TRUNCATE, suppression via une autre table du schema).
    expect(sql).not.toMatch(/\b(delete|truncate)\s+(from\s+|table\s+)?storage\s*\./i);
  });

  it("conserve la suppression de la row import_documents (SQL legitime)", () => {
    // Table applicative : le DELETE y reste autorise et demeure un controle
    // RLS pertinent — un owner doit pouvoir supprimer sa propre row.
    expect(sql).toMatch(/delete\s+from\s+public\.import_documents\s+where\s+id\s*=\s*v_did/i);
  });

  it("delegue la suppression d'objet a la Storage API, explicitement documentee", () => {
    // Le commentaire doit nommer la voie reelle ET le script runtime qui la
    // prouve : sinon le script laisse croire a un controle runtime de
    // suppression d'objet qu'il n'exerce pas.
    expect(sql).toMatch(/Storage API/);
    expect(sql).toMatch(/test-storage-delete-runtime\.js/);
  });

  it("ne pretend plus valider l'ordre row PUIS objet via SQL", () => {
    // Indique par decontexte (les deux suppressions dans le meme script SQL).
    expect(sql).not.toMatch(/suppression row PUIS objet/i);
    expect(sql).not.toMatch(/row puis objet/i);
  });

  it("conserve ET renforce le controle structurel de la policy DELETE", () => {
    // Seule garantie restante cote SQL : la policy imports_delete_owner_manager
    // doit exister, etre une policy DELETE, s'appliquer au role authenticated,
    // et ne dependre ni de la row import_documents ni de son etat.
    expect(sql).toContain("imports_delete_owner_manager");
    expect(sql).toMatch(/cmd\s*<>\s*'DELETE'/i);
    expect(sql).toMatch(/authenticated/);
    expect(sql).toContain("import_documents' in v_qual");
    expect(sql).toContain("d.state' in v_qual");
  });
});