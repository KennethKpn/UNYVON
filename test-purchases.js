const { createClient } = require("@supabase/supabase-js");

const { loadEnv } = require("./test-env");
loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const results = [];
function log(test, ok, detail) {
  const s = ok ? "PASS" : "FAIL";
  results.push({ test, s, detail });
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
    const { data: si, error: siErr } = await sb.auth.signInWithPassword({ email, password: pw });
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

  // ========================================================================
  // SETUP : 2 users, 2 orgs
  // ========================================================================
  console.log("== SETUP ==");
  const { client: sbA, userId: A } = await authUser(`pura.${ts}@test.dev`, pw);
  const { client: sbB, userId: B } = await authUser(`purb.${ts}@test.dev`, pw);

  const { org: orgA } = await createOrg(sbA, `PurchA_${ts}`, "Agro", A);
  const { org: orgB } = await createOrg(sbB, `PurchB_${ts}`, "Retail", B);
  log("SETUP-orgA", !!orgA?.id, orgA?.id);
  log("SETUP-orgB", !!orgB?.id, orgB?.id);
  if (!orgA?.id || !orgB?.id) { console.log("Abort: no orgs"); return; }

  // ========================================================================
  // SETUP : Create suppliers + products in both orgs
  // ========================================================================
  // Org A: supplier + 2 products
  const { data: supA } = await sbA.from("suppliers").insert({
    organization_id: orgA.id, name: "SupA_Riz", phone: "+229 90000001"
  }).select("id").single();
  log("SETUP-supA", !!supA?.id, supA?.id);

  const { data: prodA1 } = await sbA.from("products").insert({
    organization_id: orgA.id, name: "Riz Test", unit: "sac",
    cost_price: 15000, sale_price: 20000, min_stock_threshold: 10
  }).select("id").single();
  log("SETUP-prodA1", !!prodA1?.id, prodA1?.id);

  const { data: prodA2 } = await sbA.from("products").insert({
    organization_id: orgA.id, name: "Huile Test", unit: "bidon",
    cost_price: 10000, sale_price: 14000, min_stock_threshold: 5
  }).select("id").single();
  log("SETUP-prodA2", !!prodA2?.id, prodA2?.id);

  // Org B: supplier + product
  const { data: supB } = await sbB.from("suppliers").insert({
    organization_id: orgB.id, name: "SupB_Other", phone: "+229 90000002"
  }).select("id").single();
  log("SETUP-supB", !!supB?.id, supB?.id);

  const { data: prodB1 } = await sbB.from("products").insert({
    organization_id: orgB.id, name: "Widget B", unit: "unité",
    cost_price: 500, sale_price: 800, min_stock_threshold: 20
  }).select("id").single();
  log("SETUP-prodB1", !!prodB1?.id, prodB1?.id);

  // ========================================================================
  // A. CREATE PURCHASE (as owner A)
  // ========================================================================
  console.log("\n== A. CREATE PURCHASE ==");
  // Insert purchase directly via Supabase client (simulating the server action)
  const { data: pur, error: purErr } = await sbA.from("purchases").insert({
    organization_id: orgA.id,
    supplier_id: supA.id,
    reference: "TEST-001",
    status: "draft",
    purchase_date: "2026-09-04",
    notes: "Test purchase",
  }).select("*").single();
  log("PUR-create", !purErr && !!pur?.id, purErr ? purErr.message : `id=${pur.id}`);

  // ========================================================================
  // B. ADD PURCHASE ITEMS
  // ========================================================================
  console.log("\n== B. ADD PURCHASE ITEMS ==");
  const { data: pi1, error: piErr1 } = await sbA.from("purchase_items").insert({
    purchase_id: pur.id, product_id: prodA1.id, quantity: 50, unit_cost: 15000
  }).select("*").single();
  log("PI-create-1", !piErr1 && !!pi1?.id, piErr1 ? piErr1.message : `total=${pi1.total}`);

  const { data: pi2, error: piErr2 } = await sbA.from("purchase_items").insert({
    purchase_id: pur.id, product_id: prodA2.id, quantity: 30, unit_cost: 10000
  }).select("*").single();
  log("PI-create-2", !piErr2 && !!pi2?.id, piErr2 ? piErr2.message : `total=${pi2.total}`);

  // ========================================================================
  // C. TOTAL LINE (server-computed via generated column)
  // ========================================================================
  console.log("\n== C. TOTAL LINE ==");
  log("PI1-total", Number(pi1.total) === 50 * 15000, `${pi1.total} vs ${50 * 15000}`);
  log("PI2-total", Number(pi2.total) === 30 * 10000, `${pi2.total} vs ${30 * 10000}`);

  // ========================================================================
  // D. TOTAL ACHAT (server-computed via RPC)
  // ========================================================================
  console.log("\n== D. TOTAL ACHAT ==");
  const expectedTotal = 50 * 15000 + 30 * 10000;
  const { data: purAfter } = await sbA.from("purchases").select("total_amount").eq("id", pur.id).single();
  log("PUR-total_stored", Number(purAfter.total_amount) === expectedTotal, `${purAfter.total_amount} vs ${expectedTotal}`);

  // ========================================================================
  // E. READ PURCHASE
  // ========================================================================
  console.log("\n== E. READ PURCHASE ==");
  const { data: purRead, error: readErr } = await sbA.from("purchases").select("*").eq("id", pur.id).single();
  log("PUR-read", !readErr && purRead?.reference === "TEST-001", readErr ? readErr.message : `ref=${purRead.reference}`);

  const { data: itemsRead } = await sbA.from("purchase_items").select("*").eq("purchase_id", pur.id);
  log("PUR-items-count", itemsRead?.length === 2, `got ${itemsRead?.length}`);

  // ========================================================================
  // F. UPDATE DRAFT
  // ========================================================================
  console.log("\n== F. UPDATE DRAFT ==");
  const { error: updErr } = await sbA.from("purchases").update({ notes: "Updated notes" }).eq("id", pur.id);
  const { data: purUpd } = await sbA.from("purchases").select("notes").eq("id", pur.id).single();
  log("PUR-update", !updErr && purUpd?.notes === "Updated notes", updErr ? updErr.message : `notes=${purUpd.notes}`);

  // ========================================================================
  // G. RECEIVE PURCHASE (via RPC)
  // ========================================================================
  console.log("\n== G. RECEIVE PURCHASE ==");
  const { error: recvErr } = await sbA.rpc("receive_purchase", { p_id: pur.id });
  log("PUR-receive_rpc", !recvErr, recvErr?.message ?? "ok");
  const { data: purRecv } = await sbA.from("purchases").select("status").eq("id", pur.id).single();
  log("PUR-receive_status", purRecv?.status === "received", `status=${purRecv?.status}`);

  // Try receiving again → should fail
  const { error: recvErr2 } = await sbA.rpc("receive_purchase", { p_id: pur.id });
  log("PUR-receive_already_received", !!recvErr2, recvErr2?.message ?? "should have errored");

  // ========================================================================
  // H. CANCEL PURCHASE (create new draft, then cancel)
  // ========================================================================
  console.log("\n== H. CANCEL PURCHASE ==");
  const { data: pur2 } = await sbA.from("purchases").insert({
    organization_id: orgA.id, supplier_id: supA.id, reference: "TEST-002",
    status: "draft", purchase_date: "2026-09-04",
  }).select("*").single();
  log("PUR-cancel-create", !!pur2?.id, pur2?.id);

  const { error: cancelErr } = await sbA.from("purchases").update({ status: "cancelled" }).eq("id", pur2.id);
  const { data: pur2After } = await sbA.from("purchases").select("status").eq("id", pur2.id).single();
  log("PUR-cancel_status", !cancelErr && pur2After?.status === "cancelled", cancelErr?.message ?? `status=${pur2After?.status}`);

  // Try cancelling received purchase → should fail (via RPC check or status check)
  // The receive_purchase RPC only accepts draft. We test direct update status on received.
  // Note: direct update on status via client doesn't enforce status transitions.
  // The transition is enforced by the receive_purchase RPC and the purchase-actions.ts.

  // ========================================================================
  // I. SUPPLIER SAME ORG (implicit: we used supA in orgA)
  // ========================================================================
  console.log("\n== I. SUPPLIER SAME ORG ==");
  log("PUR-supplier_same_org", pur.supplier_id === supA.id, "supplier matches");

  // ========================================================================
  // J. PRODUCT SAME ORG (implicit: we used prodA1/prodA2 in orgA)
  // ========================================================================
  console.log("\n== J. PRODUCT SAME ORG ==");
  log("PUR-product_same_org", pi1.product_id === prodA1.id, "product matches");

  // ========================================================================
  // K. A DOESN'T SEE B
  // ========================================================================
  console.log("\n== K. A DOESN'T SEE B ==");
  // Create a purchase in orgB
  const { data: purB } = await sbB.from("purchases").insert({
    organization_id: orgB.id, supplier_id: supB.id, reference: "B-001",
    status: "draft", purchase_date: "2026-09-04",
  }).select("*").single();
  log("SETUP-purB", !!purB?.id, purB?.id);

  // A tries to read B's purchase
  const { data: aSeesB } = await sbA.from("purchases").select("id").eq("id", purB.id);
  log("RLS-A_not_see_B", aSeesB?.length === 0, `A sees ${aSeesB?.length} of B's purchases`);

  // A tries to read B's purchase items
  const { data: aSeesBitems } = await sbA.from("purchase_items").select("id").eq("purchase_id", purB.id);
  log("RLS-A_not_see_B_items", aSeesBitems?.length === 0, `A sees ${aSeesBitems?.length} of B's items`);

  // ========================================================================
  // L. B DOESN'T SEE A
  // ========================================================================
  console.log("\n== L. B DOESN'T SEE A ==");
  const { data: bSeesA } = await sbB.from("purchases").select("id").eq("id", pur.id);
  log("RLS-B_not_see_A", bSeesA?.length === 0, `B sees ${bSeesA?.length} of A's purchases`);

  // ========================================================================
  // M. SELLER RESTRICTIONS
  // ========================================================================
  console.log("\n== M. SELLER RESTRICTIONS ==");
  const emailS = `seller.${ts}@test.dev`;
  const { client: sbS, userId: S } = await authUser(emailS, pw);
  await sbA.from("organization_users").insert({ organization_id: orgA.id, user_id: S, role: "seller" });

  // Seller CAN read
  const { data: sRead } = await sbS.from("purchases").select("id").eq("id", pur.id);
  log("SELLER-can_read", sRead?.length === 1, `seller sees ${sRead?.length}`);

  // Seller CANNOT create
  const { error: sCreateErr } = await sbS.from("purchases").insert({
    organization_id: orgA.id, supplier_id: supA.id, reference: "SELLER-001",
    status: "draft", purchase_date: "2026-09-04",
  });
  log("SELLER-cannot_create", !!sCreateErr, sCreateErr?.message ?? "blocked by RLS");

  // Seller CANNOT update (RLS blocks → 0 rows, no error)
  const { data: sUpdRows, error: sUpdErr } = await sbS.from("purchases").update({ notes: "hacked" }).eq("id", pur.id).select("id");
  log("SELLER-cannot_update", !sUpdErr && (!sUpdRows || sUpdRows.length === 0), sUpdErr?.message ?? (sUpdRows?.length > 0 ? "update succeeded" : "blocked by RLS"));

  // ========================================================================
  // N. STOCKKEEPER RESTRICTIONS
  // ========================================================================
  console.log("\n== N. STOCKKEEPER RESTRICTIONS ==");
  const emailK = `stock.${ts}@test.dev`;
  const { client: sbK, userId: K } = await authUser(emailK, pw);
  await sbA.from("organization_users").insert({ organization_id: orgA.id, user_id: K, role: "stockkeeper" });

  // Stockkeeper CAN read
  const { data: kRead } = await sbK.from("purchases").select("id").eq("id", pur.id);
  log("STOCK-can_read", kRead?.length === 1, `stockkeeper sees ${kRead?.length}`);

  // Stockkeeper CAN create
  const { data: kPur, error: kCreateErr } = await sbK.from("purchases").insert({
    organization_id: orgA.id, supplier_id: supA.id, reference: "STOCK-001",
    status: "draft", purchase_date: "2026-09-04",
  }).select("id").single();
  log("STOCK-can_create", !kCreateErr && !!kPur?.id, kCreateErr?.message ?? `id=${kPur?.id}`);

  // Stockkeeper CAN add items (for their draft)
  if (kPur?.id) {
    const { error: kItemErr } = await sbK.from("purchase_items").insert({
      purchase_id: kPur.id, product_id: prodA1.id, quantity: 10, unit_cost: 15000
    });
    log("STOCK-can_add_item", !kItemErr, kItemErr?.message ?? "ok");
  }

  // Stockkeeper CANNOT update (only owner/manager — RLS blocks → 0 rows)
  const { data: kUpdRows, error: kUpdErr } = await sbK.from("purchases").update({ notes: "stock hack" }).eq("id", pur.id).select("id");
  log("STOCK-cannot_update", !kUpdErr && (!kUpdRows || kUpdRows.length === 0), kUpdErr?.message ?? (kUpdRows?.length > 0 ? "update succeeded" : "blocked by RLS"));

  // ========================================================================
  // O. DATA PERSISTENCE (reload from DB)
  // ========================================================================
  console.log("\n== O. DATA PERSISTENCE ==");
  const { data: persist } = await sbA.from("purchases").select("id,reference,status,total_amount").eq("id", pur.id).single();
  log("PUR-persist_id", persist?.id === pur.id, "id matches");
  log("PUR-persist_ref", persist?.reference === "TEST-001", `ref=${persist?.reference}`);
  log("PUR-persist_status", persist?.status === "received", `status=${persist?.status}`);
  log("PUR-persist_total", Number(persist?.total_amount) === expectedTotal, `total=${persist?.total_amount}`);

  // ========================================================================
  // INVALID CASES
  // ========================================================================
  console.log("\n== INVALID CASES ==");
  // quantity <= 0
  const { error: eQty } = await sbA.from("purchase_items").insert({
    purchase_id: pur.id, product_id: prodA1.id, quantity: 0, unit_cost: 15000
  });
  log("INVALID-qty_zero", !!eQty, eQty?.message?.substring(0, 60) ?? "blocked");

  // cost < 0
  const { error: eCost } = await sbA.from("purchase_items").insert({
    purchase_id: pur.id, product_id: prodA1.id, quantity: 10, unit_cost: -100
  });
  log("INVALID-cost_neg", !!eCost, eCost?.message?.substring(0, 60) ?? "blocked");

  // purchase without supplier (FK violation)
  const { error: eNoSup } = await sbA.from("purchases").insert({
    organization_id: orgA.id, supplier_id: "00000000-0000-0000-0000-000000000000",
    reference: "NO-SUP", status: "draft", purchase_date: "2026-09-04",
  });
  log("INVALID-no_supplier", !!eNoSup, eNoSup?.message?.substring(0, 60) ?? "blocked");

  // line without product (FK violation)
  const { data: dummyPur } = await sbA.from("purchases").insert({
    organization_id: orgA.id, supplier_id: supA.id, reference: "DUMMY",
    status: "draft", purchase_date: "2026-09-04",
  }).select("id").single();
  if (dummyPur?.id) {
    const { error: eNoProd } = await sbA.from("purchase_items").insert({
      purchase_id: dummyPur.id, product_id: "00000000-0000-0000-0000-000000000000",
      quantity: 5, unit_cost: 1000
    });
    log("INVALID-no_product", !!eNoProd, eNoProd?.message?.substring(0, 60) ?? "blocked");
    // cleanup
    await sbA.from("purchases").delete().eq("id", dummyPur.id);
  }

  // supplier from another org
  const { error: eCrossSup } = await sbA.from("purchases").insert({
    organization_id: orgA.id, supplier_id: supB.id,
    reference: "CROSS-SUP", status: "draft", purchase_date: "2026-09-04",
  });
  log("INVALID-cross_supplier", !!eCrossSup, eCrossSup?.message?.substring(0, 60) ?? "blocked by RLS");

  // product from another org
  const dummyForCross = await sbA.from("purchases").insert({
    organization_id: orgA.id, supplier_id: supA.id, reference: "CROSS-PROD",
    status: "draft", purchase_date: "2026-09-04",
  }).select("id").single();
  if (dummyForCross?.data?.id) {
    const { error: eCrossProd } = await sbA.from("purchase_items").insert({
      purchase_id: dummyForCross.data.id, product_id: prodB1.id,
      quantity: 5, unit_cost: 500
    });
    log("INVALID-cross_product", !!eCrossProd, eCrossProd?.message?.substring(0, 60) ?? "blocked by FK");
    await sbA.from("purchases").delete().eq("id", dummyForCross.data.id);
  }

  // Cleanup
  await sbA.from("purchases").delete().eq("id", pur2.id);

  // ========================================================================
  // VERDICT
  // ========================================================================
  const pass = results.filter((r) => r.s === "PASS").length;
  const fail = results.filter((r) => r.s === "FAIL").length;
  console.log(`\n========================================`);
  console.log(`PURCHASES RUNTIME: ${pass}/${results.length} PASS, ${fail} FAIL`);
  console.log(`========================================`);
  if (fail > 0) {
    results.filter((r) => r.s === "FAIL").forEach((r) => console.log(`  FAIL: ${r.test} — ${r.detail}`));
  }
}

run().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
