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

async function authUser(email, pw) {
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signUp({
    email,
    password: pw,
    options: { data: { firstName: email.split("@")[0] } },
  });
  if (error) {
    const { data: si, error: siErr } = await sb.auth.signInWithPassword({ email, password: pw });
    if (siErr) throw new Error(`Auth failed for ${email}: ${siErr.message}`);
    return { client: sb, userId: si.user.id, session: si.session };
  }
  return { client: sb, userId: data.user.id, session: data.session };
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
  const emailA = `usera.${ts}@2c.dev`;
  const emailB = `userb.${ts}@2c.dev`;
  const emailC = `userc.${ts}@2c.dev`;

  console.log("== Creating users ==");
  const { client: sbA, userId: A } = await authUser(emailA, pw);
  const { client: sbB, userId: B } = await authUser(emailB, pw);
  const { client: sbC, userId: C } = await authUser(emailC, pw);

  console.log("== Creating orgs ==");
  const orgAName = `OrgA_2c_${ts}`;
  const orgBName = `OrgB_2c_${ts}`;
  const { org: orgA, error: eA } = await createOrg(sbA, orgAName, "Agro", A);
  const { org: orgB, error: eB } = await createOrg(sbB, orgBName, "Retail", B);
  log("SETUP-orgA", !eA && !!orgA?.id, eA ? eA.message : `orgA=${orgA.id}`);
  log("SETUP-orgB", !eB && !!orgB?.id, eB ? eB.message : `orgB=${orgB.id}`);
  if (!orgA?.id || !orgB?.id) { console.log("Abort: no orgs"); return; }

  // ---- Role memberships in Org A: seller (C) and stockkeeper (C as separate? need distinct users)
  // Add user C as 'seller' in Org A, and user B... actually create a fresh user D for stockkeeper.
  const emailD = `userd.${ts}@2c.dev`;
  const { client: sbD, userId: D } = await authUser(emailD, pw);
  // A (owner) adds C as seller, D as stockkeeper in Org A
  const { error: addSeller } = await sbA.from("organization_users").insert({ organization_id: orgA.id, user_id: C, role: "seller" });
  const { error: addStock } = await sbA.from("organization_users").insert({ organization_id: orgA.id, user_id: D, role: "stockkeeper" });
  log("PERM-setup-seller", !addSeller, addSeller?.message ?? "C->seller in A");
  log("PERM-setup-stockkeeper", !addStock, addStock?.message ?? "D->stockkeeper in A");

  // ===================================================================
  // CUSTOMER CRUD (as owner A)
  // ===================================================================
  const { data: cust, error: cErr } = await sbA
    .from("customers")
    .insert({ organization_id: orgA.id, name: "Test Client CRUD", phone: "+229 90000000" })
    .select("*")
    .single();
  log("CUST-create", !cErr && !!cust?.id, cErr ? cErr.message : `id=${cust.id}`);
  const custId = cust?.id;

  const { data: custRead } = await sbA.from("customers").select("*").eq("id", custId).single();
  log("CUST-read", custRead?.name === "Test Client CRUD", `name=${custRead?.name}`);

  const { data: custUpd } = await sbA.from("customers").update({ name: "Test Client Updated" }).eq("id", custId).select();
  log("CUST-update", custUpd?.[0]?.name === "Test Client Updated", `name=${custUpd?.[0]?.name}`);

  // Archive
  const { data: custArch } = await sbA.from("customers").update({ is_active: false }).eq("id", custId).select();
  log("CUST-archive", custArch?.[0]?.is_active === false, `is_active=${custArch?.[0]?.is_active}`);
  // Restore
  const { data: custRest } = await sbA.from("customers").update({ is_active: true }).eq("id", custId).select();
  log("CUST-restore", custRest?.[0]?.is_active === true, `is_active=${custRest?.[0]?.is_active}`);

  // ===================================================================
  // SUPPLIER CRUD (as owner A)
  // ===================================================================
  const { data: sup, error: sErr } = await sbA
    .from("suppliers")
    .insert({ organization_id: orgA.id, name: "Test Supplier CRUD", phone: "+229 80000000" })
    .select("*")
    .single();
  log("SUPP-create", !sErr && !!sup?.id, sErr ? sErr.message : `id=${sup.id}`);
  const supId = sup?.id;

  const { data: supRead } = await sbA.from("suppliers").select("*").eq("id", supId).single();
  log("SUPP-read", supRead?.name === "Test Supplier CRUD", `name=${supRead?.name}`);

  const { data: supUpd } = await sbA.from("suppliers").update({ name: "Test Supplier Updated" }).eq("id", supId).select();
  log("SUPP-update", supUpd?.[0]?.name === "Test Supplier Updated", `name=${supUpd?.[0]?.name}`);

  const { data: supArch } = await sbA.from("suppliers").update({ is_active: false }).eq("id", supId).select();
  log("SUPP-archive", supArch?.[0]?.is_active === false, `is_active=${supArch?.[0]?.is_active}`);
  const { data: supRest } = await sbA.from("suppliers").update({ is_active: true }).eq("id", supId).select();
  log("SUPP-restore", supRest?.[0]?.is_active === true, `is_active=${supRest?.[0]?.is_active}`);

  // ===================================================================
  // RLS ISOLATION A / B
  // ===================================================================
  // B tries to read A's customer
  const { data: bReadA } = await sbB.from("customers").select("*").eq("id", custId).single();
  log("ISOL-B-CANNOT-read-A-cust", !bReadA, `leak=${!!bReadA}`);
  // B tries to update A's customer
  const { data: bUpdA } = await sbB.from("customers").update({ name: "HACKED" }).eq("id", custId).select();
  log("ISOL-B-CANNOT-update-A-cust", !bUpdA || bUpdA.length === 0, `affected=${bUpdA?.length ?? 0}`);
  // B tries to read A's supplier
  const { data: bReadASup } = await sbB.from("suppliers").select("*").eq("id", supId).single();
  log("ISOL-B-CANNOT-read-A-supp", !bReadASup, `leak=${!!bReadASup}`);
  // B tries to update A's supplier
  const { data: bUpdASup } = await sbB.from("suppliers").update({ name: "HACKED" }).eq("id", supId).select();
  log("ISOL-B-CANNOT-update-A-supp", !bUpdASup || bUpdASup.length === 0, `affected=${bUpdASup?.length ?? 0}`);

  // A creates data only in A; B's org should be empty of A's data
  // A reads its own customer (should see)
  const { data: aReadOwn } = await sbA.from("customers").select("*").eq("id", custId).single();
  log("ISOL-A-read-own-cust", !!aReadOwn, `seen=${!!aReadOwn}`);

  // Symmetric: create data in B, verify A cannot see/modify
  const { data: custB, error: cbErr } = await sbB
    .from("customers")
    .insert({ organization_id: orgB.id, name: "BCust", phone: "1" })
    .select("id")
    .single();
  log("ISOL-SETUP-B-cust", !cbErr && !!custB?.id, cbErr?.message ?? `id=${custB?.id}`);
  if (custB?.id) {
    const { data: aReadB } = await sbA.from("customers").select("*").eq("id", custB.id).single();
    log("ISOL-A-CANNOT-read-B-cust", !aReadB, `leak=${!!aReadB}`);
    const { data: aUpdB } = await sbA.from("customers").update({ name: "HACKED_BY_A" }).eq("id", custB.id).select();
    log("ISOL-A-CANNOT-update-B-cust", !aUpdB || aUpdB.length === 0, `affected=${aUpdB?.length ?? 0}`);
  }

  // ===================================================================
  // PERMISSIONS: seller (C) and stockkeeper (D) in Org A
  // ===================================================================
  // C (seller) can READ A's customer
  const { data: cRead } = await sbC.from("customers").select("*").eq("id", custId).single();
  log("PERM-seller-can-read", !!cRead, `seen=${!!cRead}`);
  // C (seller) CANNOT create a customer in A
  const { error: cIns } = await sbC.from("customers").insert({ organization_id: orgA.id, name: "Seller Create", phone: "2" });
  log("PERM-seller-CANNOT-create", !!cIns, cIns?.message ?? "no error (should fail)");
  // C (seller) CANNOT update A customer
  const { data: cUpd } = await sbC.from("customers").update({ name: "Seller Hack" }).eq("id", custId).select();
  log("PERM-seller-CANNOT-update", !cUpd || cUpd.length === 0, `affected=${cUpd?.length ?? 0}`);
  // C (seller) CANNOT delete A customer (RLS blocks: 0 rows, row preserved)
  const { data: cDel, error: cDelErr } = await sbC.from("customers").delete().eq("id", custId).select();
  log("PERM-seller-CANNOT-delete", cDel?.length === 0 && !cDelErr, `rows=${cDel?.length ?? 0}, err=${cDelErr?.message ?? "none"}`);
  // Row preserved after seller's blocked delete
  const { data: afterCDel } = await sbA.from("customers").select("id").eq("id", custId).single();
  log("PERM-seller-delete-row-preserved", !!afterCDel, afterCDel ? "row preserved" : "row LOST");

  // D (stockkeeper) CANNOT create/update customers or suppliers in A
  const { error: dIns } = await sbD.from("customers").insert({ organization_id: orgA.id, name: "Stock Create", phone: "3" });
  log("PERM-stockkeeper-CANNOT-create-cust", !!dIns, dIns?.message ?? "no error (should fail)");
  const { data: dUpd } = await sbD.from("suppliers").update({ name: "Stock Hack" }).eq("id", supId).select();
  log("PERM-stockkeeper-CANNOT-update-supp", !dUpd || dUpd.length === 0, `affected=${dUpd?.length ?? 0}`);

  // owner A still can (regression)
  const { data: aUpdOwn } = await sbA.from("customers").update({ notes: "owner ok" }).eq("id", custId).select();
  log("PERM-owner-can-update", aUpdOwn?.[0]?.notes === "owner ok", `notes=${aUpdOwn?.[0]?.notes}`);

  // ===================================================================
  // SUMMARY
  // ===================================================================
  console.log("\n========== PHASE 2C RUNTIME SUMMARY ==========");
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log(`PASSED: ${passed}/${results.length}`);
  if (failed > 0) {
    console.log("FAILURES:");
    results.filter((r) => r.status === "FAIL").forEach((r) => console.log(`  - ${r.test}: ${r.detail}`));
  }
  console.log(failed === 0 ? "ALL GREEN" : "HAS FAILURES");
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((e) => { console.error("FATAL:", e); process.exit(1); });
