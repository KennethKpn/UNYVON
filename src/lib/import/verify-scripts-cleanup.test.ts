import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Reversibilite des scripts de verification (finding PR #1 sur test_set_auth).
// public.test_set_auth est SECURITY DEFINER : laisse installe, il est
// appelable par PUBLIC (defaut Postgres sur le schema public) et permet
// d'usurper n'importe quel `sub` via request.jwt.claims => contournement RLS.
//
// Sans base locale (pas de Docker dans ce depot), les scripts SQL ne sont pas
// executes par `npm test` : on verrouille donc leur STRUCTURE, exactement
// comme storage-integrity.test.ts verrouille la definition effective des
// policies. Un retour en arriere (helper cree hors transaction, ou cleanup
// supprime) fait echouer ces tests.
// ---------------------------------------------------------------------------

const SUPABASE_DIR = path.join(process.cwd(), "supabase");

const HELPER_DECL = "create or replace function public.test_set_auth(uid uuid)";
const HELPER_DROP = "drop function if exists public.test_set_auth(uuid)";
const HELPER_PROBE = "to_regprocedure('public.test_set_auth(uuid)')";

const REVERSIBLE_SCRIPTS = [
  "verify-import.sql",
  "verify-import-storage.sql",
  "verify-rls.sql",
] as const;

// verify-rls.sql est le SEUL des trois a muter des donnees reelles
// (`update public.organizations set name = 'PIRATAGE'`). Ce bloc verrouille
// que cette mutation est enclose par la transaction : hors transaction, une
// regression RLS ecrirait durablement 'PIRATAGE' dans la base.
const DATA_MUTATION: Record<(typeof REVERSIBLE_SCRIPTS)[number], string | null> = {
  "verify-import.sql": null,
  "verify-import-storage.sql": null,
  "verify-rls.sql": "update public.organizations",
};

function readScript(file: string): string {
  return readFileSync(path.join(SUPABASE_DIR, file), "utf8");
}

// Index de la 1re occurrence d'une ligne donnee (indice non trimme), -1 sinon.
function firstIndexOfLine(sql: string, line: string): number {
  const index = sql.indexOf(line);
  return index;
}

// Chaque script conserve sa convention d'encodage (verify-import-storage.sql
// est volontairement ASCII) : le message d'echec est donc verrouille
// script par script, jamais suppose identique.
const SURVIVAL_MESSAGE: Record<(typeof REVERSIBLE_SCRIPTS)[number], string> = {
  "verify-import.sql":
    "ECHEC : le helper public.test_set_auth(uuid) a survécu à la vérification",
  "verify-import-storage.sql":
    "ECHEC : le helper public.test_set_auth(uuid) a survecu a la verification",
  "verify-rls.sql":
    "ECHEC : le helper public.test_set_auth(uuid) a survécu à la vérification",
};

describe.each(REVERSIBLE_SCRIPTS)("%s — reversibilite du helper test_set_auth", (file) => {
  const sql = readScript(file);

  it("declare bien le helper SECURITY DEFINER (l'objet a rendre reversible)", () => {
    expect(sql).toContain(HELPER_DECL);
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public");
  });

  it("ouvre la transaction AVANT la creation du helper", () => {
    const beginIndex = firstIndexOfLine(sql, "begin;");
    const declIndex = firstIndexOfLine(sql, HELPER_DECL);
    expect(beginIndex).toBeGreaterThan(-1);
    expect(declIndex).toBeGreaterThan(-1);
    expect(beginIndex).toBeLessThan(declIndex);
  });

  it("ferme la transaction par rollback APRES la derniere utilisation du helper", () => {
    const rollbackIndex = sql.lastIndexOf("rollback;");
    const lastUseIndex = sql.lastIndexOf("public.test_set_auth(null)");
    expect(rollbackIndex).toBeGreaterThan(-1);
    expect(lastUseIndex).toBeGreaterThan(-1);
    expect(rollbackIndex).toBeGreaterThan(lastUseIndex);
  });

  it("n'a qu'un seul rollback (le helper ne survit pas a une transaction rejouee)", () => {
    const rollbacks = sql.match(/^\s*rollback;\s*$/gim) ?? [];
    expect(rollbacks).toHaveLength(1);
  });

  it("supprime explicitement le helper apres le rollback (auto-soignage)", () => {
    expect(sql).toContain(HELPER_DROP);
    expect(sql.indexOf(HELPER_DROP)).toBeGreaterThan(sql.lastIndexOf("rollback;"));
  });

  it("prouve l'absence effective du helper, sans se contenter de la supposer", () => {
    expect(sql).toContain(HELPER_PROBE);
    expect(sql).toContain(SURVIVAL_MESSAGE[file]);
  });

  it("ne laisse aucun bloc BEGIN/COMMIT imbrique refermant la transaction", () => {
    // Un COMMIT interne persisterait le helper ; seul le ROLLBACK final est admis.
    expect(sql).not.toMatch(/^\s*commit;\s*$/im);
  });

  it("encadre chaque mutation de donnees par la transaction annulee", () => {
    const mutation = DATA_MUTATION[file];
    if (mutation === null) return; // script purement lecture
    const beginIndex = firstIndexOfLine(sql, "begin;");
    const mutationIndex = firstIndexOfLine(sql, mutation);
    const rollbackIndex = sql.lastIndexOf("rollback;");
    expect(mutationIndex).toBeGreaterThan(-1);
    // La mutation doit etre APRES le BEGIN et AVANT le ROLLBACK final.
    expect(beginIndex).toBeLessThan(mutationIndex);
    expect(mutationIndex).toBeLessThan(rollbackIndex);
  });

  it("ne recree pas le helper apres le rollback (fenetre de persistance)", () => {
    // Une redeclaration posterieure au ROLLBACK echouerait hors transaction
    // et reinstallerait durablement le helper SECURITY DEFINER.
    expect(sql.lastIndexOf(HELPER_DECL)).toBeLessThan(sql.lastIndexOf("rollback;"));
  });

  it("configure le contexte JWT en LOCAL (SET LOCAL), donc annule par le ROLLBACK", () => {
    // Le 3e argument de set_config doit valoir `true` (SET LOCAL). Avec `false`
    // (SET sessionnel), un run interrompu laisserait un `sub` forge dans la
    // session : le contexte d'impersonation survivrait au rollback.
    expect(sql).toMatch(/perform\s+set_config\(\s*'request\.jwt\.claims'/);
    expect(sql).toMatch(/\)\s*::\s*text\s*,\s*true\s*\)\s*;/);
    // Aucun set_config sessionnel ne doit subsister sur request.jwt.claims.
    expect(sql).not.toMatch(/'request\.jwt\.claims'[\s\S]{0,300}?::\s*text\s*,\s*false\s*\)\s*;/);
  });

  it("n'appelle le helper qu'a l'interieur de la transaction (SET LOCAL exige un bloc)", () => {
    // hors transaction, `SET LOCAL` est sans effet : l'impersonationechouerait
    // silencieusement et les tests RLS tourneraient sous le role reellement
    // connecte (faux positifs). Le helper est donc valide avant le premier
    // appel, et le ROLLBACK referme la transaction apres le dernier.
    const declIndex = firstIndexOfLine(sql, HELPER_DECL);
    const firstCallIndex = sql.indexOf("perform public.test_set_auth(");
    const rollbackIndex = sql.lastIndexOf("rollback;");
    expect(declIndex).toBeGreaterThan(-1);
    expect(firstCallIndex).toBeGreaterThan(-1);
    expect(rollbackIndex).toBeGreaterThan(-1);
    // BEGIN avant la declaration ET avant le premier appel.
    expect(firstIndexOfLine(sql, "begin;")).toBeLessThan(declIndex);
    expect(firstIndexOfLine(sql, "begin;")).toBeLessThan(firstCallIndex);
    // Aucun appel du helper apres le ROLLBACK (le contexte n'y existe plus).
    expect(sql.lastIndexOf("perform public.test_set_auth(")).toBeLessThan(rollbackIndex);
  });
});

// ---------------------------------------------------------------------------
// Divergence : les trois scripts DOIVENT declarer un helper strictement
// identique. Une divergence (notamment sur leFlag de set_config) ferait que
// le dernier script execute determine le comportement des suivants, puisque
// chacun recree la fonction avec `create or replace`.
// ---------------------------------------------------------------------------
describe("parite du helper test_set_auth entre les scripts", () => {
  function extractHelper(sql: string): string {
    const start = sql.indexOf(HELPER_DECL);
    const end = sql.indexOf("\n$$;", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(-1);
    return sql.slice(start, end).trim();
  }

  it("declare un corps de fonction identique dans les trois scripts", () => {
    const bodies = REVERSIBLE_SCRIPTS.map((file) => extractHelper(readScript(file)));
    expect(new Set(bodies).size).toBe(1);
  });

  it("utilise le meme drapeau set_config dans les trois scripts", () => {
    for (const file of REVERSIBLE_SCRIPTS) {
      const body = extractHelper(readScript(file));
      expect(body).toContain(")::text, true)");
      expect(body).not.toContain(")::text, false)");
    }
  });
});

// ---------------------------------------------------------------------------
// storage.objects : colonne d'ownership canonique.
//
// Sur le schema Storage reel du projet UNYVON, storage.objects porte
// `owner uuid` (depreciee) et `owner_id text` (canonique, documentee par
// Supabase). Ecrire l'ownership dans `owner` echouerait sur toute base ou la
// colonne depreciee a ete retiree, sans exercer la politique attendue.
//
// Ce bloc verrouille que les DEUX insertions du script (upload initial §2.2 et
// re-upload refuse §2.5) passent par `owner_id`, avec un cast explicite en
// texte : `owner_id` est de type text quand `owner` est de type uuid, donc
// l'affectation directe de v_user (uuid) serait un echec d'affectation de
// type — le script echouerait sur une erreur trompeuse, pas sur la RLS.
// ---------------------------------------------------------------------------
describe("verify-import-storage.sql — ownership Storage via owner_id", () => {
  const sql = readScript("verify-import-storage.sql");

  // INSERT ... storage.objects (colonnes) VALUES (valeurs);
  const STORAGE_INSERT =
    /insert\s+into\s+storage\.objects\s*\(([^)]*)\)\s*values\s*\(([\s\S]*?)\);/gi;

  function storageInserts(): Array<{ columns: string[]; values: string }> {
    return [...sql.matchAll(STORAGE_INSERT)].map((match) => ({
      columns: match[1].split(",").map((column) => column.trim()),
      values: match[2],
    }));
  }

  it("ecrit l'ownership via owner_id dans les DEUX insertions storage.objects", () => {
    const inserts = storageInserts();
    // 2 attendu : upload initial (§2.2) + re-upload refuse apres uploaded (§2.5).
    expect(inserts).toHaveLength(2);
    for (const insert of inserts) {
      expect(insert.columns).toContain("owner_id");
    }
  });

  it("ne reference plus la colonne owner depreciee dans aucune insertion", () => {
    // `\bowner\b` ne matche PAS `owner_id` : `_` etant un caractere de mot, il
    // n'existe pas de frontiere entre `owner` et `_id`. La colonne depreciee
    // reste donc detectable sans confusion avec owner_id.
    const withDeprecatedOwner = [
      ...sql.matchAll(/insert\s+into\s+storage\.objects\s*\([^)]*\bowner\b[^)]*\)/gi),
    ];
    expect(withDeprecatedOwner).toHaveLength(0);
  });

  it("caste l'identifiant en texte pour owner_id (colonne text, pas uuid)", () => {
    for (const insert of storageInserts()) {
      expect(insert.values).toMatch(/\bv_user\s*::\s*text\b/);
    }
  });

  it("n'introduit aucune qualification residuelle storage.objects.owner", () => {
    expect(sql).not.toMatch(/storage\.objects\.owner\b/i);
  });
});
describe("Smart Import — migrations de vivacité et d'autorité d'état", () => {
  const stateGate = readFileSync(
    path.join(SUPABASE_DIR, "migrations", "0025_import_materialization_state_gate.sql"),
    "utf8"
  );
  const reviewLiveness = readFileSync(
    path.join(SUPABASE_DIR, "migrations", "0024_import_review_liveness.sql"),
    "utf8"
  );

  it("refuse silencieusement toute surprise de définition avant d'altérer materialize_import_document", () => {
    expect(stateGate).toContain("pg_catalog.pg_get_functiondef");
    expect(stateGate).toContain("if v_definition is null");
    expect(stateGate).toContain("Version inattendue de materialize_import_document");
    expect(stateGate).toContain("execute v_definition");
  });

  it("injecte le garde de session AVANT le retour idempotent extracted", () => {
    const guard = "  if v_session.state not in (''processing'', ''needs_review'') then";
    const idempotence = "  if v_document.state = ''extracted'' then";
    const guardIndex = stateGate.indexOf(guard);
    const idempotenceIndex = stateGate.indexOf(idempotence);
    expect(guardIndex).toBeGreaterThan(-1);
    expect(idempotenceIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(idempotenceIndex);
  });

  it("verrouille que la finalisation refuse toute session dont un document n'est pas extracted", () => {
    expect(reviewLiveness).toMatch(
      /from\s+public\.import_documents\s+d[\s\S]{0,800}d\.state\s+<>\s+'extracted'/i
    );
    expect(reviewLiveness).toContain("Tous les documents doivent être extraits");
  });

  it("ne transforme aucune de ces migrations en fonction SECURITY DEFINER", () => {
    expect(stateGate).not.toMatch(/security\s+definer/i);
    expect(reviewLiveness).not.toMatch(/security\s+definer/i);
  });
});
