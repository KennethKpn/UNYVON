const { createClient } = require("@supabase/supabase-js");
const { loadEnv } = require("./test-env");

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anon) {
  console.error(
    "FATAL: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY absents (.env.local)"
  );
  process.exit(1);
}

const results = [];
function log(test, status, detail) {
  const s = status === true ? "PASS" : status === "SKIP" ? "SKIP" : "FAIL";
  results.push({ test, status: s, detail });
  console.log(`[${s}] ${test}: ${detail}`);
}

async function run() {
  // ============================================================
  // A. SIGNUP
  // ============================================================
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  const testEmail = `unyvon.test.${Date.now()}@gmail.com`;
  const testPw = "UnyvonTest2024!";

  const { data: signUpData, error: signUpErr } = await sb.auth.signUp({
    email: testEmail,
    password: testPw,
    options: { data: { firstName: "Test", lastName: "User" } },
  });

  if (signUpErr) {
    log("A-signup", false, signUpErr.message);
    return;
  }
  log("A-signup", !!signUpData.session, `user=${signUpData.user.id}, session=${!!signUpData.session}`);
  const userId = signUpData.user.id;

  // ============================================================
  // B. SESSION
  // ============================================================
  const { data: userData, error: userErr } = await sb.auth.getUser();
  log("B-session", !userErr && !!userData.user, `email=${userData.user?.email}`);

  // ============================================================
  // C. SIGNIN (new client)
  // ============================================================
  const sb2 = createClient(url, anon, { auth: { persistSession: false } });
  const { data: signInData, error: signInErr } = await sb2.auth.signInWithPassword({
    email: testEmail,
    password: testPw,
  });
  log("C-signin", !signInErr && !!signInData.session, signInErr ? signInErr.message : `session=true`);

  // ============================================================
  // D. SESSION AFTER RELOAD (new client, set session)
  // ============================================================
  const sb3 = createClient(url, anon, { auth: { persistSession: false } });
  const { error: setErr } = await sb3.auth.setSession({
    access_token: signInData.session.access_token,
    refresh_token: signInData.session.refresh_token,
  });
  const { data: userData2 } = await sb3.auth.getUser();
  log("D-reload", !setErr && !!userData2.user, `user=${userData2.user?.email}`);

  // ============================================================
  // E. SIGNOUT
  // ============================================================
  await sb3.auth.signOut();
  const { data: userData3 } = await sb3.auth.getUser();
  log("E-signout", !userData3.user, `user after signout=${userData3.user ?? "null"}`);

  // ============================================================
  // F. PROTECTED ROUTE WITHOUT SESSION
  // ============================================================
  const sb4 = createClient(url, anon, { auth: { persistSession: false } });
  const { data: userData4 } = await sb4.auth.getUser();
  log("F-no-session", !userData4.user, `user without session=${userData4.user ?? "null"}`);

  // ============================================================
  // ORG A–E: create org via session user
  // ============================================================
  const sbOrg = createClient(url, anon, { auth: { persistSession: false } });
  const { error: orgSignInErr } = await sbOrg.auth.signInWithPassword({
    email: testEmail,
    password: testPw,
  });
  if (orgSignInErr) { log("O-A-create-org", false, "signIn failed: " + orgSignInErr.message); return; }

  const orgName = `Org Test ${Date.now()}`;
  const { data: orgData, error: orgErr } = await sbOrg
    .from("organizations")
    .insert({ name: orgName, sector: "Commerce", currency: "FCFA", created_by: userId })
    .select("id")
    .single();

  log("O-A-create-org", !orgErr && !!orgData?.id, orgErr ? orgErr.message : `orgId=${orgData.id}`);
  const orgId = orgData?.id;

  if (orgId) {
    // O-B: verify membership owner
    const { data: membership } = await sbOrg
      .from("organization_users")
      .select("role, user_id")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .single();
    log("O-B-membership-owner", membership?.role === "owner", `role=${membership?.role}`);

    // O-C: verify subscription trial
    const { data: sub } = await sbOrg
      .from("subscriptions")
      .select("status, plan_id")
      .eq("organization_id", orgId)
      .single();
    log("O-C-subscription-trial", sub?.status === "trialing", `status=${sub?.status}`);

    // O-D: verify trigger created membership + sub atomically
    const { count: memberCount } = await sbOrg
      .from("organization_users")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId);
    const { count: subCount } = await sbOrg
      .from("subscriptions")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId);
    log("O-D-trigger-atomic", memberCount === 1 && subCount === 1, `members=${memberCount}, subs=${subCount}`);

    // O-E: read org back
    const { data: orgRead } = await sbOrg
      .from("organizations")
      .select("id, name, sector, currency")
      .eq("id", orgId)
      .single();
    log("O-E-read-org", orgRead?.name === orgName, `name=${orgRead?.name}`);
  }

  // ============================================================
  // ROLES: verify role table + permissions
  // ============================================================
  if (orgId) {
    const { data: roles } = await sbOrg
      .from("organization_users")
      .select("role");
    log("R-roles", roles?.some(r => r.role === "owner"), `roles=${JSON.stringify(roles)}`);
  }

  // ============================================================
  // Fallback: service-role key access (bypasses RLS)
  // Règle Phase 3K : la clé service_role n'est JAMAIS fournie en dur et
  // ne cible JAMAIS la base de production. Elle exige une base de
  // test/dédiée explicite (URL différente de la base applicative).
  // ============================================================
  const srUrl = process.env.SUPABASE_SERVICE_ROLE_TEST_URL;
  const srKey = process.env.SUPABASE_SERVICE_ROLE_TEST_KEY;
  if (srKey && srUrl && srUrl !== url) {
    const sbSR = createClient(srUrl, srKey, { auth: { persistSession: false } });
    const { data: allPlans, error: srErr } = await sbSR.from("plans").select("code");
    log(
      "FALLBACK-service-role",
      srErr ? false : allPlans?.length === 3,
      srErr ? srErr.message : `plans=${allPlans?.length}`
    );
  } else {
    log(
      "FALLBACK-service-role",
      "SKIP",
      "base de test dédiée requise (SUPABASE_SERVICE_ROLE_TEST_URL + SUPABASE_SERVICE_ROLE_TEST_KEY, URL ≠ base applicative) — refus d'agir en service_role contre la production"
    );
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("\n========== SUMMARY ==========");
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;
  console.log(`PASSED: ${passed}/${results.length}${skipped ? ` (SKIP: ${skipped})` : ""}`);
  if (failed > 0) {
    console.log("FAILURES:");
    results.filter((r) => r.status === "FAIL").forEach((r) => console.log(`  - ${r.test}: ${r.detail}`));
  }
  console.log("TEST_USER_EMAIL:", testEmail);
  console.log("TEST_USER_ID:", userId);
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
