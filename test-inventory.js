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
    email, password: pw,
    options: { data: { firstName: email.split("@")[0] } },
  });
  if (error) {
    const { data: si, error: siErr } = await sb.auth.signInWithPassword({ email, password: pw });
    if (siErr) throw new Error(`Auth failed for ${email}: ${siErr.message}`);
    return { client: sb, userId: si.user.id };
  }
  return { client: sb, userId: data.user.id };
}

async function run() {
  const ts = Date.now();
  const pw = "SecureTest2024!";

  // ========================================================================
  // SETUP
  // ========================================================================
  console.log("== SETUP ==");
  const { client: sbA, userId: A } = await authUser(`invA.${ts}@test.dev`, pw);
  const { client: sbB, userId: B } = await authUser(`invB.${ts}@test.dev`, pw);

  // Create orgs + membership (owner)
  const { data: orgA } = await sbA.from("organizations").insert({
    name: `InvOrgA_${ts}`, sector: "Agro", currency: "FCFA", created_by: A
  }).select("id").single();
  await sbA.from("organization_users").insert({
    organization_id: orgA.id, user_id: A, role: "owner"
  });

  const { data: orgB } = await sbB.from("organizations").insert({
    name: `InvOrgB_${ts}`, sector: "Retail", currency: "FCFA", created_by: B
  }).select("id").single();
  await sbB.from("organization_users").insert({
    organization_id: orgB.id, user_id: B, role: "owner"
  });
  log("SETUP-orgA", !!orgA?.id, orgA?.id);
  log("SETUP-orgB", !!orgB?.id, orgB?.id);

  // Create products
  const { data: prodA1 } = await sbA.from("products").insert({
    organization_id: orgA.id, name: "Riz 25kg", unit: "sac",
    cost_price: 18000, sale_price: 22000, min_stock_threshold: 100
  }).select("id").single();
  const { data: prodA2 } = await sbA.from("products").insert({
    organization_id: orgA.id, name: "Huile 5L", unit: "bidon",
    cost_price: 12000, sale_price: 15500, min_stock_threshold: 40
  }).select("id").single();
  log("SETUP-prodA1", !!prodA1?.id, prodA1?.id);
  log("SETUP-prodA2", !!prodA2?.id, prodA2?.id);

  const { data: prodB1 } = await sbB.from("products").insert({
    organization_id: orgB.id, name: "Maïs 50kg", unit: "sac",
    cost_price: 22000, sale_price: 28000, min_stock_threshold: 50
  }).select("id").single();
  log("SETUP-prodB1", !!prodB1?.id, prodB1?.id);

  // ========================================================================
  // A. OPENING STOCK
  // ========================================================================
  console.log("\n== A. OPENING STOCK ==");
  const { data: opening1, error: openErr1 } = await sbA.from("inventory_movements").insert({
    organization_id: orgA.id, product_id: prodA1.id, movement_type: "opening",
    quantity: 340, unit_cost: 18000, reason: "Stock initial", created_by: A
  }).select("*").single();
  log("OPEN-create", !openErr1 && !!opening1?.id, openErr1?.message ?? `qty=${opening1?.quantity}`);

  // ========================================================================
  // B. STOCK CALCULATION
  // ========================================================================
  console.log("\n== B. STOCK CALCULATION ==");
  const { data: stock1 } = await sbA.rpc("get_product_stock", {
    p_org_id: orgA.id, p_product_id: prodA1.id
  });
  log("STOCK-calc_opening", stock1 === 340, `got ${stock1}`);

  // ========================================================================
  // C. POSITIVE MOVEMENT (purchase_receipt)
  // ========================================================================
  console.log("\n== C. POSITIVE MOVEMENT ==");
  const { data: receipt1, error: recErr1 } = await sbA.from("inventory_movements").insert({
    organization_id: orgA.id, product_id: prodA1.id,
    movement_type: "purchase_receipt", quantity: 100,
    unit_cost: 17500, reference_type: "purchase", reason: "Réception", created_by: A
  }).select("*").single();
  log("RECEIPT-create", !recErr1 && !!receipt1?.id, recErr1?.message ?? `qty=${receipt1?.quantity}`);

  const { data: stock2 } = await sbA.rpc("get_product_stock", {
    p_org_id: orgA.id, p_product_id: prodA1.id
  });
  log("STOCK-after_receipt", stock2 === 440, `got ${stock2}`);

  // ========================================================================
  // D. NEGATIVE MOVEMENT (adjustment_out)
  // ========================================================================
  console.log("\n== D. NEGATIVE MOVEMENT ==");
  const { data: adjOut, error: adjOutErr } = await sbA.from("inventory_movements").insert({
    organization_id: orgA.id, product_id: prodA1.id,
    movement_type: "adjustment_out", quantity: 20, reason: "Casse", created_by: A
  }).select("*").single();
  log("ADJ-OUT-create", !adjOutErr && !!adjOut?.id, adjOutErr?.message ?? `qty=${adjOut?.quantity}`);

  const { data: stock3 } = await sbA.rpc("get_product_stock", {
    p_org_id: orgA.id, p_product_id: prodA1.id
  });
  log("STOCK-after_adj_out", stock3 === 420, `got ${stock3}`);

  // ========================================================================
  // E. PURCHASE RECEIPT via receive_purchase()
  // ========================================================================
  console.log("\n== E. PURCHASE RECEICTION ==");
  const { data: supA } = await sbA.from("suppliers").insert({
    organization_id: orgA.id, name: "SupInv", phone: "+229 90000999"
  }).select("id").single();

  const { data: purchase } = await sbA.from("purchases").insert({
    organization_id: orgA.id, supplier_id: supA.id, reference: "INV-TEST-001",
    status: "draft", purchase_date: "2026-09-04"
  }).select("id").single();

  await sbA.from("purchase_items").insert({
    purchase_id: purchase.id, product_id: prodA2.id, quantity: 50, unit_cost: 12000
  });

  const { error: recvErr } = await sbA.rpc("receive_purchase", { p_id: purchase.id });
  log("RECV-purchase", !recvErr, recvErr?.message ?? "ok");

  const { data: recvMovements } = await sbA.from("inventory_movements")
    .select("id, quantity, movement_type")
    .eq("reference_type", "purchase")
    .eq("reference_id", purchase.id);
  log("RECV-movement_created", recvMovements?.length === 1, `got ${recvMovements?.length}`);

  const { data: stock4 } = await sbA.rpc("get_product_stock", {
    p_org_id: orgA.id, p_product_id: prodA2.id
  });
  log("STOCK-after_receive", stock4 === 50, `got ${stock4}`);

  // ========================================================================
  // F. NO DUPLICATE RECEIVE
  // ========================================================================
  console.log("\n== F. NO DUPLICATE RECEIVE ==");
  const { error: dupRecvErr } = await sbA.rpc("receive_purchase", { p_id: purchase.id });
  log("RECV-no_duplicate", !!dupRecvErr, dupRecvErr?.message?.substring(0, 60) ?? "allowed");

  // ========================================================================
  // G. INVENTORY PHYSICAL COUNT
  // ========================================================================
  console.log("\n== G. INVENTORY PHYSICAL COUNT ==");
  const { data: count1, error: countErr1 } = await sbA.rpc("create_inventory_and_adjust", {
    p_org_id: orgA.id, p_product_id: prodA1.id, p_physical_qty: 410,
    p_reason: "counting_error", p_notes: "Inventaire mensuel"
  });
  log("COUNT-create", !countErr1, countErr1?.message ?? "ok");

  const { data: countRecord } = await sbA.from("inventory_counts")
    .select("theoretical_qty, physical_qty, gap, reason")
    .eq("product_id", prodA1.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  log("COUNT-recorded", !!countRecord, `theo=${countRecord?.theoretical_qty} phys=${countRecord?.physical_qty} gap=${countRecord?.gap}`);
  log("COUNT-gap_correct", countRecord?.gap === -10, `gap=${countRecord?.gap}`);

  // ========================================================================
  // H. NEGATIVE ADJUSTMENT (from count)
  // ========================================================================
  console.log("\n== H. NEGATIVE ADJUSTMENT ==");
  const { data: stock5 } = await sbA.rpc("get_product_stock", {
    p_org_id: orgA.id, p_product_id: prodA1.id
  });
  log("STOCK-after_count_adj", stock5 === 410, `got ${stock5}`);

  // ========================================================================
  // I. POSITIVE ADJUSTMENT (manual)
  // ========================================================================
  console.log("\n== I. POSITIVE ADJUSTMENT ==");
  const { data: adjIn, error: adjInErr } = await sbA.from("inventory_movements").insert({
    organization_id: orgA.id, product_id: prodA1.id,
    movement_type: "adjustment_in", quantity: 15,
    reason: "Erreur de saisie corrigée", created_by: A
  }).select("*").single();
  log("ADJ-IN-create", !adjInErr && !!adjIn?.id, adjInErr?.message ?? `qty=${adjIn?.quantity}`);

  const { data: stock6 } = await sbA.rpc("get_product_stock", {
    p_org_id: orgA.id, p_product_id: prodA1.id
  });
  log("STOCK-after_adj_in", stock6 === 425, `got ${stock6}`);

  // ========================================================================
  // J. ADJUSTMENT REASON
  // ========================================================================
  console.log("\n== J. ADJUSTMENT REASON ==");
  const { data: adjReason } = await sbA.from("inventory_movements")
    .select("reason")
    .eq("id", adjIn.id)
    .single();
  log("ADJ-reason", adjReason?.reason === "Erreur de saisie corrigée", `reason=${adjReason?.reason}`);

  // ========================================================================
  // K. HISTORY
  // ========================================================================
  console.log("\n== K. HISTORY ==");
  const { data: history } = await sbA.from("inventory_movements")
    .select("id, movement_type, quantity")
    .eq("product_id", prodA1.id)
    .order("created_at", { ascending: true });
  log("HISTORY-count", history?.length === 5, `got ${history?.length}`);
  log("HISTORY-types", history?.map(h => h.movement_type).join(",") === "opening,purchase_receipt,adjustment_out,adjustment_out,adjustment_in", history?.map(h => h.movement_type).join(","));

  // ========================================================================
  // L. A CANNOT SEE B
  // ========================================================================
  console.log("\n== L. A CANNOT SEE B ==");
  const { data: aSeesB } = await sbA.from("inventory_movements")
    .select("id").eq("product_id", prodB1.id);
  log("RLS-A_not_see_B_movements", aSeesB?.length === 0, `A sees ${aSeesB?.length} of B's movements`);

  const { data: aSeesBcounts } = await sbA.from("inventory_counts")
    .select("id").eq("product_id", prodB1.id);
  log("RLS-A_not_see_B_counts", aSeesBcounts?.length === 0, `A sees ${aSeesBcounts?.length} of B's counts`);

  // ========================================================================
  // M. B CANNOT SEE A
  // ========================================================================
  console.log("\n== M. B CANNOT SEE A ==");
  const { data: bSeesA } = await sbB.from("inventory_movements")
    .select("id").eq("product_id", prodA1.id);
  log("RLS-B_not_see_A_movements", bSeesA?.length === 0, `B sees ${bSeesA?.length} of A's movements`);

  // ========================================================================
  // N. SELLER RESTRICTIONS
  // ========================================================================
  console.log("\n== N. SELLER RESTRICTIONS ==");
  const emailS = `seller_inv.${ts}@test.dev`;
  const { client: sbS, userId: S } = await authUser(emailS, pw);
  await sbA.from("organization_users").insert({
    organization_id: orgA.id, user_id: S, role: "seller"
  });

  // Seller CAN read
  const { data: sRead } = await sbS.from("inventory_movements")
    .select("id").eq("product_id", prodA1.id);
  log("SELLER-can_read_movements", sRead?.length > 0, `seller sees ${sRead?.length}`);

  // Seller CANNOT create movement
  const { error: sCreateErr } = await sbS.from("inventory_movements").insert({
    organization_id: orgA.id, product_id: prodA1.id,
    movement_type: "adjustment_in", quantity: 999, reason: "hack", created_by: S
  });
  log("SELLER-cannot_create_movement", !!sCreateErr, sCreateErr?.message?.substring(0, 60) ?? "blocked");

  // Seller CANNOT create inventory count (security definer, but checks role)
  const { error: sCountErr } = await sbS.rpc("create_inventory_and_adjust", {
    p_org_id: orgA.id, p_product_id: prodA1.id, p_physical_qty: 0,
    p_reason: "other", p_notes: "hack"
  });
  log("SELLER-cannot_create_count", !!sCountErr, sCountErr?.message?.substring(0, 60) ?? "blocked");

  // ========================================================================
  // O. STOCKKEEPER PERMISSIONS
  // ========================================================================
  console.log("\n== O. STOCKKEEPER PERMISSIONS ==");
  const emailK = `stock_inv.${ts}@test.dev`;
  const { client: sbK, userId: K } = await authUser(emailK, pw);
  await sbA.from("organization_users").insert({
    organization_id: orgA.id, user_id: K, role: "stockkeeper"
  });

  // Stockkeeper CAN create movement
  const { data: kMov, error: kMovErr } = await sbK.from("inventory_movements").insert({
    organization_id: orgA.id, product_id: prodA2.id,
    movement_type: "adjustment_in", quantity: 10, reason: "Réappro stockkeeper", created_by: K
  }).select("id").single();
  log("STOCK-can_create_movement", !kMovErr && !!kMov?.id, kMovErr?.message ?? `id=${kMov?.id}`);

  // Stockkeeper CAN create inventory count
  const { error: kCountErr } = await sbK.rpc("create_inventory_and_adjust", {
    p_org_id: orgA.id, p_product_id: prodA2.id, p_physical_qty: 60,
    p_reason: "counting_error", p_notes: "Contrôle stockkeeper"
  });
  log("STOCK-can_create_count", !kCountErr, kCountErr?.message ?? "ok");

  // ========================================================================
  // P. PERSISTENCE AFTER RELOAD
  // ========================================================================
  console.log("\n== P. PERSISTENCE ==");
  const { data: persisted } = await sbA.from("inventory_movements")
    .select("id, movement_type, quantity, product_id")
    .eq("product_id", prodA1.id)
    .order("created_at", { ascending: true });
  log("PERSIST-movements_count", persisted?.length === 5, `got ${persisted?.length}`);

  const { data: persistedCount } = await sbA.from("inventory_counts")
    .select("id, gap, reason")
    .eq("product_id", prodA1.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  log("PERSIST-count_exists", !!persistedCount?.id, `gap=${persistedCount?.gap}`);

  const { data: finalStock } = await sbA.rpc("get_product_stock", {
    p_org_id: orgA.id, p_product_id: prodA1.id
  });
  log("PERSIST-final_stock", finalStock === 425, `got ${finalStock}`);

  // ========================================================================
  // INVALID CASES
  // ========================================================================
  console.log("\n== INVALID CASES ==");
  const { error: eQty0 } = await sbA.from("inventory_movements").insert({
    organization_id: orgA.id, product_id: prodA1.id,
    movement_type: "adjustment_in", quantity: 0, reason: "test", created_by: A
  });
  log("INVALID-qty_zero", !!eQty0, eQty0?.message?.substring(0, 60) ?? "blocked");

  const { error: eQtyNeg } = await sbA.from("inventory_movements").insert({
    organization_id: orgA.id, product_id: prodA1.id,
    movement_type: "adjustment_in", quantity: -5, reason: "test", created_by: A
  });
  log("INVALID-qty_negative", !!eQtyNeg, eQtyNeg?.message?.substring(0, 60) ?? "blocked");

  const { error: eCrossOrg } = await sbA.from("inventory_movements").insert({
    organization_id: orgA.id, product_id: prodB1.id,
    movement_type: "opening", quantity: 100, reason: "cross-org", created_by: A
  });
  log("INVALID-cross_org_product", !!eCrossOrg, eCrossOrg?.message?.substring(0, 60) ?? "blocked by RLS");

  const { error: eNoProd } = await sbA.from("inventory_movements").insert({
    organization_id: orgA.id,
    product_id: "00000000-0000-0000-0000-000000000000",
    movement_type: "opening", quantity: 100, reason: "ghost", created_by: A
  });
  log("INVALID-nonexistent_product", !!eNoProd, eNoProd?.message?.substring(0, 60) ?? "blocked");

  // ========================================================================
  // VERDICT
  // ========================================================================
  const pass = results.filter((r) => r.s === "PASS").length;
  const fail = results.filter((r) => r.s === "FAIL").length;
  console.log(`\n========================================`);
  console.log(`INVENTORY RUNTIME: ${pass}/${results.length} PASS, ${fail} FAIL`);
  console.log(`========================================`);
  if (fail > 0) {
    results.filter((r) => r.s === "FAIL").forEach((r) => console.log(`  FAIL: ${r.test} — ${r.detail}`));
  }
}

run().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
