/**
 * PHASE 3J — Test de régression : détection de doublons téléphone client
 *
 * Vérifie que :
 * 1. Deux clients de la MÊME organisation peuvent porter le même numéro
 *    (aucune unicité globale imposée — décision explicite laissée à l'utilisateur).
 * 2. La détection findCustomerPhoneMatches renvoie bien le premier client
 *    quand un numéro dupliqué est recherché.
 * 3. Des numéros formats différemment (espaces, tirets) sont détectés comme doublons.
 * 4. Deux organisations DIFFÉRENTES peuvent partager un numéro (isolation).
 * 5. Un numéro en base est modifiable librement (pas de contrainte bloquante).
 * 6. RLS : la détection ne fuite pas les clients d'une autre organisation.
 *
 * Run: node test-phone-duplicate.js
 */

const { createClient } = require("@supabase/supabase-js");

const { loadEnv } = require("./test-env");
loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const results = [];
function log(test, ok, detail) {
  const status = ok ? "PASS" : "FAIL";
  results.push({ test, status, detail });
  console.log(`[${status}] ${test}: ${detail}`);
}

function normalizePhone(phone) {
  return (phone ?? "").replace(/[\s\-().]/g, "").trim();
}

async function authUser(email, pw) {
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signUp({
    email,
    password: pw,
    options: { data: { firstName: email.split("@")[0] } },
  });
  if (error) {
    const { data: si, error: siErr } = await sb.auth.signInWithPassword({
      email,
      password: pw,
    });
    if (siErr) throw new Error(`Auth failed for ${email}: ${siErr.message}`);
    return { client: sb, userId: si.user.id };
  }
  return { client: sb, userId: data.user.id };
}

async function createOrg(client, name, sector, userId) {
  const { data, error } = await client
    .from("organizations")
    .insert({ name, sector, currency: "FCFA", created_by: userId })
    .select("id")
    .single();
  return { org: data, error };
}

async function run() {
  const ts = Date.now();
  const pw = "SecureTest2024!";
  const phoneShared = `+229 97 ${String(ts).slice(-6)} 00`;
  const phoneNormalized = normalizePhone(phoneShared);

  console.log("== SETUP ==");
  const { client: sbA, userId: A } = await authUser(`phonea.${ts}@test.dev`, pw);
  const { client: sbB, userId: B } = await authUser(`phoneb.${ts}@test.dev`, pw);

  const { org: orgA, error: eA } = await createOrg(sbA, `OrgA_phone_${ts}`, "Agro", A);
  const { org: orgB, error: eB } = await createOrg(sbB, `OrgB_phone_${ts}`, "Retail", B);
  log("SETUP-orgA", !eA && !!orgA?.id, eA ? eA.message : `id=${orgA?.id}`);
  log("SETUP-orgB", !eB && !!orgB?.id, eB ? eB.message : `id=${orgB?.id}`);
  if (!orgA?.id || !orgB?.id) {
    console.log("Abort: setup failed");
    process.exit(1);
  }

  // ========================================================================
  // 1. Création client avec numéro
  // ========================================================================
  console.log("\n== CREATE CUSTOMER WITH PHONE ==");
  const { data: cust1, error: c1Err } = await sbA
    .from("customers")
    .insert({
      organization_id: orgA.id,
      name: "Client Un",
      phone: phoneShared,
    })
    .select("*")
    .single();
  log("CUST1-created", !c1Err && !!cust1?.id, c1Err ? c1Err.message : `id=${cust1?.id}`);

  // ========================================================================
  // 2. MÊME numéro dans la MÊME organisation : DOIT être autorisé
  //    (pas de contrainte d'unicité — décision explicite utilisateur)
  // ========================================================================
  console.log("\n== DUPLICATE WITHIN SAME ORG (allowed) ==");
  const { data: cust2, error: c2Err } = await sbA
    .from("customers")
    .insert({
      organization_id: orgA.id,
      name: "Client Deux",
      phone: phoneShared,
    })
    .select("*")
    .single();
  log(
    "DUP-same-org-allowed",
    !c2Err && !!cust2?.id,
    c2Err
      ? `REJETÉ À TORT: ${c2Err.message}`
      : `deuxième client créé avec le même numéro (id=${cust2.id})`
  );

  // ========================================================================
  // 3. Détection : le numéro dupliqué ressort dans les matches de l'org
  //    (simule findCustomerPhoneMatches côté serveur)
  // ========================================================================
  console.log("\n== DETECTION ==");
  const { data: allA } = await sbA
    .from("customers")
    .select("id, name, phone")
    .eq("organization_id", orgA.id)
    .neq("phone", null);
  const matchesA = (allA ?? []).filter(
    (c) => normalizePhone(c.phone) === phoneNormalized
  );
  log(
    "DETECT-finds-both",
    matchesA.length === 2,
    `matches=${matchesA.length} (${matchesA.map((m) => m.name).join(", ")})`
  );

  // Recherche avec un format différent (espaces/tirets différents)
  const altFormat = phoneShared.replace(/ /g, "-");
  const matchesAlt = (allA ?? []).filter(
    (c) => normalizePhone(c.phone) === normalizePhone(altFormat)
  );
  log(
    "DETECT-format-insensitive",
    matchesAlt.length === 2,
    `format="${altFormat}" → matches=${matchesAlt.length}`
  );

  // Un numéro sans correspondance ne doit rien retourner
  const matchesNone = (allA ?? []).filter(
    (c) => normalizePhone(c.phone) === "+22900000000"
  );
  log("DETECT-no-false-positive", matchesNone.length === 0, `matches=${matchesNone.length}`);

  // ========================================================================
  // 4. Même numéro dans une AUTRE organisation : autorisé ET invisible (RLS)
  // ========================================================================
  console.log("\n== CROSS-ORG ==");
  const { data: custB, error: cbErr } = await sbB
    .from("customers")
    .insert({
      organization_id: orgB.id,
      name: "Client Org B",
      phone: phoneShared,
    })
    .select("*")
    .single();
  log(
    "CROSS-same-phone-other-org-allowed",
    !cbErr && !!custB?.id,
    cbErr ? `REJETÉ À TORT: ${cbErr.message}` : `id=${custB?.id}`
  );

  // A ne doit PAS voir le client de B (isolation RLS de la détection)
  const { data: aSeesB } = await sbA
    .from("customers")
    .select("id")
    .eq("id", custB.id);
  log(
    "RLS-A-cannot-detect-B",
    (aSeesB ?? []).length === 0,
    `lignes visibles par A=${(aSeesB ?? []).length}`
  );
  const { data: bSeesA } = await sbB
    .from("customers")
    .select("id")
    .eq("id", cust1.id);
  log(
    "RLS-B-cannot-detect-A",
    (bSeesA ?? []).length === 0,
    `lignes visibles par B=${(bSeesA ?? []).length}`
  );

  // ========================================================================
  // 5. Modification libre : le numéro peut être changé sans blocage
  // ========================================================================
  console.log("\n== UPDATE ==");
  const newPhone = `+229 98 ${String(ts).slice(-6)} 55`;
  const { data: upd, error: updErr } = await sbA
    .from("customers")
    .update({ phone: newPhone })
    .eq("id", cust1.id)
    .select();
  log(
    "UPDATE-phone-free",
    !updErr && upd?.[0]?.phone === newPhone,
    updErr ? updErr.message : `phone=${upd?.[0]?.phone}`
  );

  // Mise à jour vers un numéro déjà utilisé par un autre client de l'org :
  // doit rester autorisé (avertissement côté UI, jamais de rejet DB)
  const { data: updDup, error: updDupErr } = await sbA
    .from("customers")
    .update({ phone: phoneShared })
    .eq("id", cust1.id)
    .select();
  log(
    "UPDATE-to-duplicate-allowed",
    !updDupErr && updDup?.[0]?.phone === phoneShared,
    updDupErr ? `REJETÉ À TORT: ${updDupErr.message}` : `phone=${updDup?.[0]?.phone}`
  );

  // ========================================================================
  // 6. Suppression → NON : archivage (is_active=false) conserve l'historique
  // ========================================================================
  console.log("\n== ARCHIVE NOT DELETE ==");
  const { data: arch, error: archErr } = await sbA
    .from("customers")
    .update({ is_active: false })
    .eq("id", cust2.id)
    .select();
  log(
    "ARCHIVE-soft-delete",
    !archErr && arch?.[0]?.is_active === false,
    archErr ? archErr.message : `is_active=${arch?.[0]?.is_active}`
  );
  // La ligne existe toujours (historique conservé)
  const { data: stillThere } = await sbA
    .from("customers")
    .select("id")
    .eq("id", cust2.id)
    .single();
  log("ARCHIVE-row-preserved", !!stillThere, stillThere ? "ligne conservée" : "ligne PERDUE");

  // ========================================================================
  // SUMMARY
  // ========================================================================
  console.log("\n========== PHONE DUPLICATE REGRESSION SUMMARY ==========");
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log(`PASSED: ${passed}/${results.length}`);
  if (failed > 0) {
    console.log("FAILURES:");
    results
      .filter((r) => r.status === "FAIL")
      .forEach((r) => console.log(`  - ${r.test}: ${r.detail}`));
  }
  console.log(failed === 0 ? "ALL GREEN" : "HAS FAILURES");
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
