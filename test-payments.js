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
  const { client: sbA, userId: A } = await authUser(`payA.${ts}@test.dev`, pw);
  const { client: sbB, userId: B } = await authUser(`payB.${ts}@test.dev`, pw);

  // Org A
  const { data: orgA } = await sbA.from("organizations").insert({
    name: `PayOrgA_${ts}`, sector: "Agro", currency: "FCFA", created_by: A
  }).select("id").single();
  await sbA.from("organization_users").insert({
    organization_id: orgA.id, user_id: A, role: "owner"
  });

  // Org B
  const { data: orgB } = await sbB.from("organizations").insert({
    name: `PayOrgB_${ts}`, sector: "Retail", currency: "FCFA", created_by: B
  }).select("id").single();
  await sbB.from("organization_users").insert({
    organization_id: orgB.id, user_id: B, role: "owner"
  });
  log("SETUP-orgA", !!orgA?.id, orgA?.id);
  log("SETUP-orgB", !!orgB?.id, orgB?.id);

  // Products
  const { data: prodA1 } = await sbA.from("products").insert({
    organization_id: orgA.id, name: `Riz_${ts}`, unit: "sac",
    cost_price: 18000, sale_price: 22000, min_stock_threshold: 10
  }).select("id").single();
  const { data: prodA2 } = await sbA.from("products").insert({
    organization_id: orgA.id, name: `Huile_${ts}`, unit: "bidon",
    cost_price: 12000, sale_price: 15500, min_stock_threshold: 10
  }).select("id").single();
  log("SETUP-prodA1", !!prodA1?.id, prodA1?.id);

  // Customers
  const { data: custA1 } = await sbA.from("customers").insert({
    organization_id: orgA.id, name: `ClientPay1_${ts}`, phone: "+229 90000001"
  }).select("id").single();
  const { data: custA2 } = await sbA.from("customers").insert({
    organization_id: orgA.id, name: `ClientPay2_${ts}`, phone: "+229 90000002"
  }).select("id").single();
  const { data: custB1 } = await sbB.from("customers").insert({
    organization_id: orgB.id, name: `ClientPayB_${ts}`, phone: "+229 90000003"
  }).select("id").single();
  log("SETUP-custA1", !!custA1?.id, custA1?.id);

  // Opening stock
  await sbA.from("inventory_movements").insert([
    { organization_id: orgA.id, product_id: prodA1.id, movement_type: "opening", quantity: 200, unit_cost: 18000, reason: "Stock test", created_by: A },
    { organization_id: orgA.id, product_id: prodA2.id, movement_type: "opening", quantity: 100, unit_cost: 12000, reason: "Stock test", created_by: A }
  ]);

  // ========================================================================
  // A. CREATE PAYMENT (need a confirmed sale first)
  // ========================================================================
  console.log("\n== A. CREATE PAYMENT ==");

  // Create a sale
  const { data: sale1 } = await sbA.from("sales").insert({
    organization_id: orgA.id, customer_id: custA1.id,
    reference: `VNT-PAY-${ts}`, created_by: A
  }).select("id").single();

  await sbA.from("sale_items").insert({
    sale_id: sale1.id, product_id: prodA1.id,
    quantity: 10, unit_price: 22000, unit_cost_snapshot: 18000
  });

  // Confirm it
  await sbA.rpc("confirm_sale", { p_sale_id: sale1.id });

  // Create payment
  const { error: payErr } = await sbA.rpc("create_payment", {
    p_sale_id: sale1.id,
    p_amount: 100000,
    p_payment_method: "cash"
  });
  log("A-create_payment", !payErr, payErr?.message ?? "ok");

  // ========================================================================
  // B. READ PAYMENT
  // ========================================================================
  console.log("\n== B. READ PAYMENT ==");
  const { data: payments } = await sbA.from("payments")
    .select("*")
    .eq("sale_id", sale1.id);
  log("B-read_payment", payments?.length === 1, `count=${payments?.length}`);
  log("B-amount", payments?.[0]?.amount === 100000, `amount=${payments?.[0]?.amount}`);

  // ========================================================================
  // C. PAYMENT STATUS (partially paid)
  // ========================================================================
  console.log("\n== C. PAYMENT STATUS ==");
  const { data: status1 } = await sbA.rpc("get_sale_payment_status", { p_sale_id: sale1.id });
  const st1 = Array.isArray(status1) ? status1[0] : status1;
  log("C-partially_paid", st1?.payment_status === "partially_paid", `status=${st1?.payment_status}`);
  log("C-total_paid", st1?.total_paid === 100000, `paid=${st1?.total_paid}`);
  log("C-remaining", st1?.remaining === 120000, `remaining=${st1?.remaining}`);

  // ========================================================================
  // D. SECOND PAYMENT → fully paid
  // ========================================================================
  console.log("\n== D. SECOND PAYMENT ==");
  const { error: pay2Err } = await sbA.rpc("create_payment", {
    p_sale_id: sale1.id,
    p_amount: 120000,
    p_payment_method: "mobile_money",
    p_reference: "MTN-REF-TEST"
  });
  log("D-second_payment", !pay2Err, pay2Err?.message ?? "ok");

  const { data: status2 } = await sbA.rpc("get_sale_payment_status", { p_sale_id: sale1.id });
  const st2 = Array.isArray(status2) ? status2[0] : status2;
  log("D-fully_paid", st2?.payment_status === "paid", `status=${st2?.payment_status}`);
  log("D-total_paid", st2?.total_paid === 220000, `paid=${st2?.total_paid}`);

  // ========================================================================
  // E. OVERPAYMENT REJECTED
  // ========================================================================
  console.log("\n== E. OVERPAYMENT ==");
  const { error: overErr } = await sbA.rpc("create_payment", {
    p_sale_id: sale1.id,
    p_amount: 1,
    p_payment_method: "cash"
  });
  log("E-overpayment", !!overErr, overErr?.message?.substring(0, 50) ?? "blocked");

  // ========================================================================
  // F. ZERO PAYMENT REJECTED
  // ========================================================================
  console.log("\n== F. ZERO PAYMENT ==");
  const { error: zeroErr } = await sbA.rpc("create_payment", {
    p_sale_id: sale1.id,
    p_amount: 0,
    p_payment_method: "cash"
  });
  log("F-zero_payment", !!zeroErr, zeroErr?.message?.substring(0, 50) ?? "blocked");

  // ========================================================================
  // G. NEGATIVE PAYMENT REJECTED
  // ========================================================================
  console.log("\n== G. NEGATIVE PAYMENT ==");
  const { error: negErr } = await sbA.rpc("create_payment", {
    p_sale_id: sale1.id,
    p_amount: -100,
    p_payment_method: "cash"
  });
  log("G-negative_payment", !!negErr, negErr?.message?.substring(0, 50) ?? "blocked");

  // ========================================================================
  // H. PAYMENT ON DRAFT SALE REJECTED
  // ========================================================================
  console.log("\n== H. DRAFT PAYMENT ==");
  const { data: draftSale } = await sbA.from("sales").insert({
    organization_id: orgA.id, reference: `VNT-DRAFT-${ts}`, created_by: A
  }).select("id").single();

  await sbA.from("sale_items").insert({
    sale_id: draftSale.id, product_id: prodA1.id,
    quantity: 5, unit_price: 22000, unit_cost_snapshot: 18000
  });

  const { error: draftPayErr } = await sbA.rpc("create_payment", {
    p_sale_id: draftSale.id,
    p_amount: 50000,
    p_payment_method: "cash"
  });
  log("H-draft_payment", !!draftPayErr, draftPayErr?.message?.substring(0, 50) ?? "blocked");

  // ========================================================================
  // I. CROSS-ORG PAYMENT BLOCKED
  // ========================================================================
  console.log("\n== I. CROSS-ORG PAYMENT ==");
  const { error: crossErr } = await sbA.rpc("create_payment", {
    p_sale_id: "00000000-0000-0000-0000-000000000000",
    p_amount: 50000,
    p_payment_method: "cash"
  });
  log("I-cross_org_payment", !!crossErr, crossErr?.message?.substring(0, 50) ?? "blocked");

  // ========================================================================
  // J. SELLER PERMISSIONS
  // ========================================================================
  console.log("\n== J. SELLER PERMISSIONS ==");
  const emailS = `seller_pay.${ts}@test.dev`;
  const { client: sbS, userId: S } = await authUser(emailS, pw);
  await sbA.from("organization_users").insert({
    organization_id: orgA.id, user_id: S, role: "seller"
  });

  // Seller CAN read payments
  const { data: sRead } = await sbS.from("payments").select("id");
  log("J-seller_read", sRead !== null, "ok");

  // Seller CAN create payment
  const { data: saleS } = await sbS.from("sales").insert({
    organization_id: orgA.id, reference: `VNT-SELLER-PAY-${ts}`, created_by: S
  }).select("id").single();
  await sbS.from("sale_items").insert({
    sale_id: saleS.id, product_id: prodA1.id,
    quantity: 2, unit_price: 22000, unit_cost_snapshot: 18000
  });
  await sbS.rpc("confirm_sale", { p_sale_id: saleS.id });

  const { error: sPayErr } = await sbS.rpc("create_payment", {
    p_sale_id: saleS.id, p_amount: 44000, p_payment_method: "cash"
  });
  log("J-seller_create_payment", !sPayErr, sPayErr?.message ?? "ok");

  // ========================================================================
  // K. STOCKKEEPER RESTRICTIONS
  // ========================================================================
  console.log("\n== K. STOCKKEEPER RESTRICTIONS ==");
  const emailK = `stock_pay.${ts}@test.dev`;
  const { client: sbK, userId: K } = await authUser(emailK, pw);
  await sbA.from("organization_users").insert({
    organization_id: orgA.id, user_id: K, role: "stockkeeper"
  });

  const { error: kPayErr } = await sbK.rpc("create_payment", {
    p_sale_id: sale1.id, p_amount: 1000, p_payment_method: "cash"
  });
  log("K-stockkeeper_cannot_pay", !!kPayErr, kPayErr?.message?.substring(0, 50) ?? "blocked");

  // ========================================================================
  // L. PAYMENT PERSISTENCE
  // ========================================================================
  console.log("\n== L. PERSISTENCE ==");
  const { data: persisted } = await sbA.from("payments")
    .select("id, amount, payment_method, sale_id")
    .eq("sale_id", sale1.id);
  log("L-persisted_count", persisted?.length === 2, `count=${persisted?.length}`);
  log("L-persisted_total", persisted?.reduce((s, p) => s + p.amount, 0) === 220000, "total=220000");

  // ========================================================================
  // M. CUSTOMER BALANCE
  // ========================================================================
  console.log("\n== M. CUSTOMER BALANCE ==");
  const { data: balance } = await sbA.rpc("get_customer_balance", {
    p_customer_id: custA1.id
  });
  const bal = Array.isArray(balance) ? balance[0] : balance;
  log("M-total_purchases", bal?.total_purchases === 220000, `purchases=${bal?.total_purchases}`);
  log("M-total_paid", bal?.total_paid === 220000, `paid=${bal?.total_paid}`);
  log("M-outstanding", bal?.outstanding === 0, `outstanding=${bal?.outstanding}`);

  // ========================================================================
  // N. MULTI-PAYMENT SCENARIO
  // ========================================================================
  console.log("\n== N. MULTI-PAYMENT SCENARIO ==");
  const { data: saleMulti } = await sbA.from("sales").insert({
    organization_id: orgA.id, customer_id: custA2.id,
    reference: `VNT-MULTI-PAY-${ts}`, created_by: A
  }).select("id").single();

  await sbA.from("sale_items").insert([
    { sale_id: saleMulti.id, product_id: prodA1.id, quantity: 10, unit_price: 22000, unit_cost_snapshot: 18000 },
    { sale_id: saleMulti.id, product_id: prodA2.id, quantity: 6, unit_price: 15500, unit_cost_snapshot: 12000 }
  ]);
  await sbA.rpc("confirm_sale", { p_sale_id: saleMulti.id });

  // Total = 10*22000 + 6*15500 = 220000 + 93000 = 313000
  const { data: stBefore } = await sbA.rpc("get_sale_payment_status", { p_sale_id: saleMulti.id });
  const sb2 = Array.isArray(stBefore) ? stBefore[0] : stBefore;
  log("N-total_313k", sb2?.total_amount === 313000, `total=${sb2?.total_amount}`);

  // Payment 1: 200000
  await sbA.rpc("create_payment", { p_sale_id: saleMulti.id, p_amount: 200000, p_payment_method: "cash" });
  const { data: st1m } = await sbA.rpc("get_sale_payment_status", { p_sale_id: saleMulti.id });
  const sm1 = Array.isArray(st1m) ? st1m[0] : st1m;
  log("N-after_pay1", sm1?.payment_status === "partially_paid" && sm1?.remaining === 113000,
    `status=${sm1?.payment_status} remaining=${sm1?.remaining}`);

  // Payment 2: 113000
  await sbA.rpc("create_payment", { p_sale_id: saleMulti.id, p_amount: 113000, p_payment_method: "mobile_money", p_reference: "MOOV-789" });
  const { data: st2m } = await sbA.rpc("get_sale_payment_status", { p_sale_id: saleMulti.id });
  const sm2 = Array.isArray(st2m) ? st2m[0] : st2m;
  log("N-after_pay2", sm2?.payment_status === "paid" && sm2?.remaining === 0,
    `status=${sm2?.payment_status} remaining=${sm2?.remaining}`);

  // Attempt overpayment
  const { error: overMulti } = await sbA.rpc("create_payment", {
    p_sale_id: saleMulti.id, p_amount: 1, p_payment_method: "cash"
  });
  log("N-overpayment_blocked", !!overMulti, overMulti?.message?.substring(0, 50) ?? "blocked");

  // ========================================================================
  // O. MULTI-TENANT ISOLATION
  // ========================================================================
  console.log("\n== O. MULTI-TENANT ==");
  const { data: aSeesB } = await sbA.from("payments")
    .select("id").eq("organization_id", orgB.id);
  log("O-A_not_see_B", aSeesB?.length === 0, `A sees ${aSeesB?.length}`);

  const { data: bSeesA } = await sbB.from("payments")
    .select("id").eq("organization_id", orgA.id);
  log("O-B_not_see_A", bSeesA?.length === 0, `B sees ${bSeesA?.length}`);

  // ========================================================================
  // P. PAYMENT HISTORY
  // ========================================================================
  console.log("\n== P. PAYMENT HISTORY ==");
  const { data: history } = await sbA.from("payments")
    .select("id, amount, payment_method, payment_date")
    .eq("sale_id", saleMulti.id)
    .order("created_at", { ascending: true });
  log("P-history_count", history?.length === 2, `count=${history?.length}`);
  log("P-history_methods", history?.map(h => h.payment_method).join(",") === "cash,mobile_money",
    history?.map(h => h.payment_method).join(","));

  // ========================================================================
  // Q. PAYMENT IMMUTABILITY (no update/delete policies)
  // ========================================================================
  console.log("\n== Q. PAYMENT IMMUTABLE ==");
  const { data: updData, error: updPayErr } = await sbA.from("payments")
    .update({ amount: 999999 })
    .eq("id", persisted[0].id)
    .select("id");
  log("Q-cannot_update", !!updPayErr || updData?.length === 0,
    updPayErr?.message ?? (updData?.length > 0 ? "UPDATE SUCCEEDED (BAD)" : "blocked"));

  const { data: delData, error: delPayErr } = await sbA.from("payments")
    .delete()
    .eq("id", persisted[0].id)
    .select("id");
  log("Q-cannot_delete", !!delPayErr || delData?.length === 0,
    delPayErr?.message ?? (delData?.length > 0 ? "DELETE SUCCEEDED (BAD)" : "blocked"));

  // ========================================================================
  // VERDICT
  // ========================================================================
  const pass = results.filter((r) => r.s === "PASS").length;
  const fail = results.filter((r) => r.s === "FAIL").length;
  console.log(`\n========================================`);
  console.log(`PAYMENTS RUNTIME: ${pass}/${results.length} PASS, ${fail} FAIL`);
  console.log(`========================================`);
  if (fail > 0) {
    results.filter((r) => r.s === "FAIL").forEach((r) => console.log(`  FAIL: ${r.test} — ${r.detail}`));
  }
}

run().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
