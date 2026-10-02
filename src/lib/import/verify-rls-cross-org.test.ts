import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Determinisme du test d'isolation cross-org (verify-rls.sql, section 3).
//
// La section 3 doit prouver : UTILISATEUR B (org B) -> tentative de
// modification de l'ORGANISATION A (org A), avec org B <> org A.
//
// La version anterieure designait le second owner par `limit 1 offset 1`, sans
// garantir qu'il appartient a une organisation differente de celle de A, et
// ciblait ensuite l'organisation via une sous-requete implicite. Sur une base
// de test ou deux owners partagent la MEME organisation, la RLS autorisait
// legitimement l'ecriture : `v_updated = 1` levait alors un faux
// `ECHEC D'ISOLATION : modification cross-org possible`, renvoyant vers une
// faille qui n'existait pas.
//
// Sans base locale (pas de Docker dans ce depot), les scripts SQL ne sont pas
// executes par `npm test` : on verrouille donc la STRUCTURE de la section 3,
// comme storage-integrity.test.ts verrouille la definition effective des
// policies. Un retour en arriere (offset nu, sous-requete implicite, filtre
// `organization_id <> v_org_a` retiré) fait echouer ces tests.
// ---------------------------------------------------------------------------

const SUPABASE_DIR = path.join(process.cwd(), "supabase");

const SECTION_3_BANNER =
  "-- 3. Isolation : l'utilisateur B ne peut PAS modifier l'organisation A";

function readRlsScript(): string {
  return readFileSync(path.join(SUPABASE_DIR, "verify-rls.sql"), "utf8");
}

// Section 3 = du bandeau numerote jusqu'au `end $$;` qui la clot.
function section3(sql: string): string {
  const start = sql.indexOf(SECTION_3_BANNER);
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf("end $$;", start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("verify-rls.sql section 3 — isolation cross-org deterministe", () => {
  const block = section3(readRlsScript());

  it("selectionne explicitement le owner A et son organisation v_org_a", () => {
    expect(block).toContain("into v_user_a, v_org_a");
  });

  it("selectionne le owner B EXCLUSIVEMENT dans une autre organisation", () => {
    expect(block).toContain("organization_id <> v_org_a");
  });

  it("selectionne le owner B APRES le owner A", () => {
    const selectA = block.indexOf("into v_user_a, v_org_a");
    const selectB = block.indexOf("into v_user_b");
    expect(selectA).toBeGreaterThan(-1);
    expect(selectB).toBeGreaterThan(selectA);
  });

  it("n'utilise aucun OFFSET pour designer le owner B", () => {
    // `limit 1 offset 1` designait le 2e owner par ordre de creation, sans
    // garantir l'appartenance a une organisation differente : deux owners
    // d'une meme organisation suffisaient a produire un faux echec.
    expect(block).not.toMatch(/\boffset\b/i);
  });

  it("cible l'organization A par v_org_a, sans sous-requete implicite", () => {
    expect(block).toContain("where id = v_org_a");
    expect(block).not.toMatch(/where\s+id\s*=\s*\(\s*select/i);
  });

  it("impersonne v_user_b seulement apres l'avoir selectionne", () => {
    const selectB = block.indexOf("into v_user_b");
    const impersonate = block.indexOf("perform public.test_set_auth(v_user_b)");
    expect(selectB).toBeGreaterThan(-1);
    expect(impersonate).toBeGreaterThan(selectB);
  });

  it("quitte le test avec un notice explicite s'il n'existe pas d'autre organisation", () => {
    // Sans owner dans une organisation distincte, le scenario cross-org est
    // inapplicable : le test doit le dire et sortir, jamais tester A contre A.
    expect(block).toMatch(/if\s+v_user_b\s+is\s+null\s+then[\s\S]*?raise notice[\s\S]*?return;/);
  });

  it("conserve la mutation RLS et son attendu v_updated = 0", () => {
    expect(block).toContain("update public.organizations");
    expect(block).toContain("set name = 'PIRATAGE'");
    expect(block).toContain("if v_updated = 0 then");
    expect(block).toContain("ECHEC D''ISOLATION : modification cross-org possible");
  });
});