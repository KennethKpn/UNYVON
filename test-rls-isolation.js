const { createClient } = require("@supabase/supabase-js");

const { loadEnv } = require("./test-env");
loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const results = [];
function log(test, ok, detail) {
  const s = ok ? "PASS" : "FAIL";
  results.push({ test, status: s, detail });
  console.log(`[${s}] ${test}: ${detail}`);
}

async function authUser(email, pw) {
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signUp({
    email,
    password: pw,
    options: { data: { firstName: email.split("@")[0] } },
  });
  if (error) {
    // user might exist, try signin
    const { data: si, error: siErr } = await sb.auth.signInWithPassword({ email, password: pw });
    if (siErr) throw new Error(`Auth failed for ${email}: ${siErr.message}`);
    return { client: sb, userId: si.user.id, session: si.session };
  }
  return { client: sb, userId: data.user.id, session: data.session };
}

async function run() {
  const ts = Date.now();
  const emailA = `userA.${ts}@test.dev`;
  const emailB = `userB.${ts}@test.dev`;
  const pw = "SecureTest2024!";

  console.log("Creating User A...");
  const { client: sbA, userId: userIdA } = await authUser(emailA, pw);
  console.log("User A:", userIdA);

  console.log("Creating User B...");
  const { client: sbB, userId: userIdB } = await authUser(emailB, pw);
  console.log("User B:", userIdB);

  // --- User A creates Org A ---
  const orgAName = `OrgA_${ts}`;
  const { data: orgA, error: errA } = await sbA
    .from("organizations")
    .insert({ name: orgAName, sector: "Tech", currency: "FCFA", created_by: userIdA })
    .select("id")
    .single();
  log("ISOL-A-create-orgA", !errA && !!orgA?.id, errA ? errA.message : `orgA=${orgA.id}`);

  // --- User B creates Org B ---
  const orgBName = `OrgB_${ts}`;
  const { data: orgB, error: errB } = await sbB
    .from("organizations")
    .insert({ name: orgBName, sector: "Retail", currency: "FCFA", created_by: userIdB })
    .select("id")
    .single();
  log("ISOL-B-create-orgB", !errB && !!orgB?.id, errB ? errB.message : `orgB=${orgB.id}`);

  if (!orgA?.id || !orgB?.id) {
    console.log("Cannot continue without both orgs.");
    return;
  }

  // --- A reads Org A (should succeed) ---
  const { data: readA } = await sbA
    .from("organizations")
    .select("id, name")
    .eq("id", orgA.id)
    .single();
  log("ISOL-A-read-A", readA?.name === orgAName, `name=${readA?.name}`);

  // --- A reads Org B (should FAIL — isolation) ---
  const { data: readBfromA } = await sbA
    .from("organizations")
    .select("id, name")
    .eq("id", orgB.id)
    .single();
  log("ISOL-A-CANNOT-read-B", !readBfromA, `leaked=${!!readBfromA}`);

  // --- A tries to update Org B (should FAIL — 0 rows affected) ---
  const { data: updA } = await sbA
    .from("organizations")
    .update({ name: "HACKED_BY_A" })
    .eq("id", orgB.id)
    .select();
  log("ISOL-A-CANNOT-update-B", !updA || updA.length === 0, `affected=${updA?.length ?? 0}`);

  // --- B reads Org B (should succeed) ---
  const { data: readBB } = await sbB
    .from("organizations")
    .select("id, name")
    .eq("id", orgB.id)
    .single();
  log("ISOL-B-read-B", readBB?.name === orgBName, `name=${readBB?.name}`);

  // --- B reads Org A (should FAIL — isolation) ---
  const { data: readAfromB } = await sbB
    .from("organizations")
    .select("id, name")
    .eq("id", orgA.id)
    .single();
  log("ISOL-B-CANNOT-read-A", !readAfromB, `leaked=${!!readAfromB}`);

  // --- B tries to update Org A (should FAIL — 0 rows) ---
  const { data: updB } = await sbB
    .from("organizations")
    .update({ name: "HACKED_BY_B" })
    .eq("id", orgA.id)
    .select();
  log("ISOL-B-CANNOT-update-A", !updB || updB.length === 0, `affected=${updB?.length ?? 0}`);

  // --- A cannot see B's memberships ---
  const { data: membershipsA } = await sbA
    .from("organization_users")
    .select("role, user_id")
    .eq("organization_id", orgB.id);
  log("ISOL-A-CANNOT-see-B-members", !membershipsA || membershipsA.length === 0, `leaked=${membershipsA?.length ?? 0}`);

  // --- A cannot see B's subscriptions ---
  const { data: subsA } = await sbA
    .from("subscriptions")
    .select("status")
    .eq("organization_id", orgB.id);
  log("ISOL-A-CANNOT-see-B-subs", !subsA || subsA.length === 0, `leaked=${subsA?.length ?? 0}`);

  // --- A can read plans (public) ---
  const { data: plans } = await sbA.from("plans").select("code");
  log("ISOL-A-plans-readable", plans?.length === 3, `plans=${plans?.length}`);

  // --- B can read plans (public) ---
  const { data: plansB } = await sbB.from("plans").select("code");
  log("ISOL-B-plans-readable", plansB?.length === 3, `plans=${plansB?.length}`);

  // --- Verify trigger created memberships ---
  const { data: membersA } = await sbA
    .from("organization_users")
    .select("role")
    .eq("organization_id", orgA.id);
  log("ISOL-A-owner-membership", membersA?.some((m) => m.role === "owner"), JSON.stringify(membersA));

  const { data: membersB } = await sbB
    .from("organization_users")
    .select("role")
    .eq("organization_id", orgB.id);
  log("ISOL-B-owner-membership", membersB?.some((m) => m.role === "owner"), JSON.stringify(membersB));

  // --- Verify subscriptions ---
  const { data: subA } = await sbA
    .from("subscriptions")
    .select("status, trial_end")
    .eq("organization_id", orgA.id)
    .single();
  log("ISOL-A-trial", subA?.status === "trialing", `status=${subA?.status}, end=${subA?.trial_end}`);

  const { data: subB } = await sbB
    .from("subscriptions")
    .select("status, trial_end")
    .eq("organization_id", orgB.id)
    .single();
  log("ISOL-B-trial", subB?.status === "trialing", `status=${subB?.status}, end=${subB?.trial_end}`);

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("\n========== RLS ISOLATION SUMMARY ==========");
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log(`PASSED: ${passed}/${results.length}`);
  if (failed > 0) {
    console.log("FAILURES:");
    results.filter((r) => r.status === "FAIL").forEach((r) => console.log(`  - ${r.test}: ${r.detail}`));
  }
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
