const { createClient } = require("@supabase/supabase-js");
const { loadEnv } = require("./test-env");

loadEnv();

// Règle Phase 3K : ce script lit en service_role (bypass RLS). Il n'utilise
// ni clé en dur, ni la base de production — uniquement une base de test
// dédiée, explicite et distincte de la base applicative.
const url = process.env.SUPABASE_SERVICE_ROLE_TEST_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_TEST_KEY;
const appUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

if (!service || !url || url === appUrl) {
  console.log(
    "SKIP: base de test dédiée requise (SUPABASE_SERVICE_ROLE_TEST_URL + SUPABASE_SERVICE_ROLE_TEST_KEY, URL ≠ base applicative). " +
      "Le service_role ne cible jamais la base de production."
  );
  console.log("\n=== VERDICT: SKIP ===");
  process.exit(0);
}

const sb = createClient(url, service, { auth: { persistSession: false } });
const results = [];
function log(test, ok, detail) {
  const s = ok ? "PASS" : "FAIL";
  results.push({ test, s, detail });
  console.log(`[${s}] ${test}: ${detail}`);
}

async function run() {
  console.log("== Orgs ==");
  const { data: orgs, error: orgErr } = await sb.from("organizations").select("*");
  log("ORG-list", !orgErr && Array.isArray(orgs), orgErr ? orgErr.message : `${orgs?.length} org(s)`);
  if (orgs?.length) {
    orgs.forEach((o) => console.log(`  - ${o.name} (${o.id})`));
  }

  console.log("== Customers ==");
  const { data: custs, error: cErr } = await sb.from("customers").select("*");
  log("CUST-list", !cErr && Array.isArray(custs), cErr ? cErr.message : `${custs?.length} client(s)`);
  custs?.forEach((c) => console.log(`  - ${c.name} | ${c.phone} | org=${c.organization_id}`));

  console.log("== Suppliers ==");
  const { data: supps, error: sErr } = await sb.from("suppliers").select("*");
  log("SUPP-list", !sErr && Array.isArray(supps), sErr ? sErr.message : `${supps?.length} fournisseur(s)`);
  supps?.forEach((s) => console.log(`  - ${s.name} | ${s.phone} | org=${s.organization_id}`));

  const okCount = results.filter((r) => r.s === "PASS").length;
  console.log(`\n=== VERDICT: ${okCount}/${results.length} PASS ===`);
}

run().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
