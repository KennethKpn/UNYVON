// ============================================================================
// UNYVON — Phase 2H Tests: Expenses + Cash Flow
// ============================================================================

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
  let cfP = null; // will be set during cashflow tests

  // ========================================================================
  // SETUP
  // ========================================================================
  console.log("== SETUP ==");
  const { client: sbA, userId: A } = await authUser(`expA.${ts}@test.dev`, pw);
  const { client: sbB, userId: B } = await authUser(`expB.${ts}@test.dev`, pw);
  const { client: sbSeller } = await authUser(`expSeller.${ts}@test.dev`, pw);
  const { client: sbStock } = await authUser(`expStock.${ts}@test.dev`, pw);

  // Org A + membership
  const { data: orgA } = await sbA.from("organizations").insert({
    name: `ExpOrgA_${ts}`, sector: "Agro", currency: "FCFA", created_by: A
  }).select("id").single();
  await sbA.from("organization_users").insert({
    organization_id: orgA.id, user_id: A, role: "owner"
  });
  log("SETUP-orgA", !!orgA?.id, orgA?.id);

  // Org B + membership
  const { data: orgB } = await sbB.from("organizations").insert({
    name: `ExpOrgB_${ts}`, sector: "Retail", currency: "FCFA", created_by: B
  }).select("id").single();
  await sbB.from("organization_users").insert({
    organization_id: orgB.id, user_id: B, role: "owner"
  });
  log("SETUP-orgB", !!orgB?.id, orgB?.id);

  // Seller in Org A
  await sbA.from("organization_users").insert({
    organization_id: orgA.id, user_id: (await sbSeller.auth.getUser()).data.user.id, role: "seller"
  });

  // Stockkeeper in Org A
  await sbA.from("organization_users").insert({
    organization_id: orgA.id, user_id: (await sbStock.auth.getUser()).data.user.id, role: "stockkeeper"
  });

  // ========================================================================
  // A. CREATE EXPENSE
  // ========================================================================
  console.log("\n== A. CREATE EXPENSE ==");
  const { data: exp1, error: exp1Err } = await sbA.from("expenses").insert({
    organization_id: orgA.id, category: "rent", description: "Loyer test",
    amount: 50000, expense_date: "2026-09-15", payment_method: "cash", created_by: A,
  }).select("*").single();
  log("A-create_expense", !exp1Err, exp1Err?.message ?? exp1?.id);

  // ========================================================================
  // B. READ EXPENSE
  // ========================================================================
  console.log("\n== B. READ EXPENSE ==");
  const { data: readExp } = await sbA.from("expenses")
    .select("*").eq("id", exp1.id).single();
  log("B-read_expense", !!readExp, readExp?.description);
  log("B-amount", readExp?.amount == 50000, `amount=${readExp?.amount}`);

  // ========================================================================
  // C. UPDATE EXPENSE
  // ========================================================================
  console.log("\n== C. UPDATE EXPENSE ==");
  const { error: updErr } = await sbA.from("expenses")
    .update({ description: "Loyer mis à jour", amount: 75000 })
    .eq("id", exp1.id);
  log("C-update_expense", !updErr, updErr?.message);
  const { data: updExp } = await sbA.from("expenses")
    .select("description,amount").eq("id", exp1.id).single();
  log("C-updated_values",
    updExp?.description === "Loyer mis à jour" && updExp?.amount == 75000,
    `desc="${updExp?.description}" amount=${updExp?.amount}`);

  // ========================================================================
  // D. DELETE EXPENSE
  // ========================================================================
  console.log("\n== D. DELETE EXPENSE ==");
  const { data: toDel } = await sbA.from("expenses").insert({
    organization_id: orgA.id, category: "other", description: "À supprimer",
    amount: 10000, expense_date: "2026-09-15", payment_method: "cash", created_by: A,
  }).select("id").single();
  const { error: delErr } = await sbA.from("expenses").delete().eq("id", toDel.id);
  log("D-delete_expense", !delErr, delErr?.message);
  const { data: delCheck } = await sbA.from("expenses").select("id").eq("id", toDel.id).single();
  log("D-deleted_gone", !delCheck, delCheck?.id ?? "gone");

  // ========================================================================
  // E. AMOUNT VALIDATION
  // ========================================================================
  console.log("\n== E. AMOUNT VALIDATION ==");
  const { error: eZero } = await sbA.from("expenses").insert({
    organization_id: orgA.id, category: "other", description: "Zero",
    amount: 0, expense_date: "2026-09-15", payment_method: "cash", created_by: A,
  });
  log("E-amount_zero_rejected", !!eZero, eZero?.message?.substring(0, 60));

  const { error: eNeg } = await sbA.from("expenses").insert({
    organization_id: orgA.id, category: "other", description: "Neg",
    amount: -5000, expense_date: "2026-09-15", payment_method: "cash", created_by: A,
  });
  log("E-amount_negative_rejected", !!eNeg, eNeg?.message?.substring(0, 60));

  const { error: ePos } = await sbA.from("expenses").insert({
    organization_id: orgA.id, category: "other", description: "Pos",
    amount: 100, expense_date: "2026-09-15", payment_method: "cash", created_by: A,
  });
  log("E-amount_positive_ok", !ePos, ePos?.message);

  // ========================================================================
  // F. CATEGORIES
  // ========================================================================
  console.log("\n== F. CATEGORIES ==");
  const cats = ["rent", "transport", "personnel", "electricity", "communication", "supplies", "maintenance", "other"];
  let catOk = true;
  for (const cat of cats) {
    const { error } = await sbA.from("expenses").insert({
      organization_id: orgA.id, category: cat, description: `Cat ${cat}`,
      amount: 10000, expense_date: "2026-09-15", payment_method: "cash", created_by: A,
    });
    if (error) { catOk = false; console.log(`  F-err ${cat}: ${error.message}`); }
  }
  log("F-all_categories", catOk, `${cats.length} catégories`);

  const { error: badCat } = await sbA.from("expenses").insert({
    organization_id: orgA.id, category: "invalid_cat", description: "Bad",
    amount: 10000, expense_date: "2026-09-15", payment_method: "cash", created_by: A,
  });
  log("F-invalid_category_rejected", !!badCat, badCat?.message?.substring(0, 60));

  // ========================================================================
  // G. PAYMENT METHODS
  // ========================================================================
  console.log("\n== G. PAYMENT METHODS ==");
  const methods = ["cash", "mobile_money", "bank_transfer", "other"];
  let methOk = true;
  for (const m of methods) {
    const { error } = await sbA.from("expenses").insert({
      organization_id: orgA.id, category: "other", description: `Meth ${m}`,
      amount: 5000, expense_date: "2026-09-15", payment_method: m, created_by: A,
    });
    if (error) { methOk = false; console.log(`  G-err ${m}: ${error.message}`); }
  }
  log("G-all_payment_methods", methOk, `${methods.length} méthodes`);

  // ========================================================================
  // H. DATE
  // ========================================================================
  console.log("\n== H. DATE ==");
  log("H-date_stored", readExp?.expense_date === "2026-09-15", `date=${readExp?.expense_date}`);

  // ========================================================================
  // I. MULTI-TENANT ISOLATION
  // ========================================================================
  console.log("\n== I. MULTI-TENANT ==");
  const { data: expB } = await sbB.from("expenses").insert({
    organization_id: orgB.id, category: "transport", description: "Org B expense",
    amount: 25000, expense_date: "2026-09-15", payment_method: "cash", created_by: B,
  }).select("id").single();
  log("I-orgB_created", !!expB?.id, expB?.id);

  const { data: aSeesB } = await sbA.from("expenses").select("id").eq("id", expB.id).single();
  log("I-A_not_see_B", !aSeesB, aSeesB?.id ?? "hidden");

  const { data: bSeesA } = await sbB.from("expenses").select("id").eq("id", exp1.id).single();
  log("I-B_not_see_A", !bSeesA, bSeesA?.id ?? "hidden");

  // ========================================================================
  // J. ROLE RESTRICTIONS
  // ========================================================================
  console.log("\n== J. ROLE RESTRICTIONS ==");
  const { error: sellerErr } = await sbSeller.from("expenses").insert({
    organization_id: orgA.id, category: "other", description: "Seller try",
    amount: 5000, expense_date: "2026-09-15", payment_method: "cash",
    created_by: (await sbSeller.auth.getUser()).data.user.id,
  });
  log("J-seller_cannot_create", !!sellerErr, sellerErr?.message?.substring(0, 60));

  const { error: stockErr } = await sbStock.from("expenses").insert({
    organization_id: orgA.id, category: "other", description: "Stock try",
    amount: 5000, expense_date: "2026-09-15", payment_method: "cash",
    created_by: (await sbStock.auth.getUser()).data.user.id,
  });
  log("J-stockkeeper_cannot_create", !!stockErr, stockErr?.message?.substring(0, 60));

  // ========================================================================
  // K. PERSISTENCE
  // ========================================================================
  console.log("\n== K. PERSISTENCE ==");
  const { data: allExp } = await sbA.from("expenses").select("id,amount");
  log("K-persistence_count", allExp && allExp.length > 5, `count=${allExp?.length}`);

  // ========================================================================
  // L. EXPENSE SUMMARY (RPC)
  // ========================================================================
  console.log("\n== L. SUMMARY ==");
  const { data: summary, error: sumErr } = await sbA.rpc("get_expenses_summary", {
    p_org_id: orgA.id, p_from: null, p_to: null,
  });
  log("L-summary_no_error", !sumErr, sumErr?.message);
  log("L-summary_has_data", summary && summary.length > 0, `categories=${summary?.length}`);

  // ========================================================================
  // M. CASHFLOW
  // ========================================================================
  console.log("\n== M. CASHFLOW ==");
  // Create product + stock + confirmed sale + payment
  const { data: prod, error: prodErr } = await sbA.from("products").insert({
    organization_id: orgA.id, name: `ProdCash_${ts}`, unit: "sac",
    cost_price: 8000, sale_price: 12000, min_stock_threshold: 5,
  }).select("id").single();
  log("M-product_created", !!prod?.id, prodErr?.message ?? prod?.id);

  if (!prod?.id) {
    console.log("  SKIP: cashflow tests — product creation failed");
    log("M-cashflow_no_error", false, "skipped");
    log("M-cashflow_receipts", false, "skipped");
    log("M-cashflow_expenses", false, "skipped");
    log("M-cashflow_net", false, "skipped");
    log("N-credit_no_cashflow_change", false, "skipped");
    log("N-payment_increases_cashflow", false, "skipped");
  } else {

  await sbA.from("inventory_movements").insert({
    organization_id: orgA.id, product_id: prod.id,
    movement_type: "opening", quantity: 50, created_by: A,
  });

  const { data: cust, error: custErr } = await sbA.from("customers").insert({
    organization_id: orgA.id, name: `CustCash_${ts}`, phone: "+22990000099",
  }).select("id").single();
  log("M-customer_created", !!cust?.id, custErr?.message ?? cust?.id);

  const { data: sale, error: saleErr } = await sbA.from("sales").insert({
    organization_id: orgA.id, customer_id: cust?.id ?? null,
    status: "draft", sale_date: "2026-09-15", created_by: A,
  }).select("id").single();
  log("M-sale_created", !!sale?.id, saleErr?.message ?? sale?.id);

  const { error: itemErr } = await sbA.from("sale_items").insert({
    sale_id: sale?.id, product_id: prod.id,
    quantity: 5, unit_price: 12000, unit_cost_snapshot: 8000,
  });
  log("M-sale_item_created", !itemErr, itemErr?.message);

  if (!sale?.id) {
    console.log("  SKIP: cashflow tests — sale creation failed");
    log("M-payment_created", false, "skipped");
    log("M-cashflow_no_error", false, "skipped");
    log("M-cashflow_receipts", false, "skipped");
    log("M-cashflow_expenses", false, "skipped");
    log("M-cashflow_net", false, "skipped");
    log("N-credit_no_cashflow_change", false, "skipped");
    log("N-payment_increases_cashflow", false, "skipped");
  } else {

  await sbA.rpc("confirm_sale", { p_sale_id: sale.id });

  // Payment = 200k encaissement
  const { error: payErr } = await sbA.rpc("create_payment", {
    p_sale_id: sale.id, p_amount: 60000, p_payment_method: "cash",
  });
  log("M-payment_created", !payErr, payErr?.message);

  const { data: cf, error: cfErr } = await sbA.rpc("get_cashflow_summary", {
    p_org_id: orgA.id, p_from: null, p_to: null,
  });
  const cfRow = Array.isArray(cf) ? cf[0] : cf;
  log("M-cashflow_no_error", !cfErr, cfErr?.message);
  log("M-cashflow_receipts", (cfRow?.total_receipts ?? 0) > 0, `receipts=${cfRow?.total_receipts}`);
  log("M-cashflow_expenses", (cfRow?.total_expenses ?? 0) > 0, `expenses=${cfRow?.total_expenses}`);
  log("M-cashflow_net", cfRow?.net_cashflow !== undefined, `net=${cfRow?.net_cashflow}`);

  // ========================================================================
  // N. CREDIT SALE DOES NOT INFLATE CASHFLOW
  // ========================================================================
  console.log("\n== N. CREDIT SALE TEST ==");
  const { data: cfBefore } = await sbA.rpc("get_cashflow_summary", {
    p_org_id: orgA.id, p_from: null, p_to: null,
  });
  const cfB = Array.isArray(cfBefore) ? cfBefore[0] : cfBefore;

  // Create credit sale (no payment)
  const { data: creditSale, error: creditErr } = await sbA.from("sales").insert({
    organization_id: orgA.id, customer_id: cust?.id ?? null,
    status: "draft", sale_date: "2026-09-16", created_by: A,
  }).select("id").single();
  log("N-credit_sale_created", !!creditSale?.id, creditErr?.message ?? creditSale?.id);

  if (!creditSale?.id) {
    log("N-credit_no_cashflow_change", false, "skipped");
    log("N-payment_increases_cashflow", false, "skipped");
  } else {

  await sbA.from("sale_items").insert({
    sale_id: creditSale.id, product_id: prod.id,
    quantity: 3, unit_price: 12000, unit_cost_snapshot: 8000,
  });

  await sbA.rpc("confirm_sale", { p_sale_id: creditSale.id });

  const { data: cfAfter } = await sbA.rpc("get_cashflow_summary", {
    p_org_id: orgA.id, p_from: null, p_to: null,
  });
  const cfA = Array.isArray(cfAfter) ? cfAfter[0] : cfAfter;

  log("N-credit_no_cashflow_change",
    cfB?.total_receipts === cfA?.total_receipts,
    `receipts before=${cfB?.total_receipts} after=${cfA?.total_receipts}`);

  // Pay 10k on credit sale → cashflow should increase by 10k
  await sbA.rpc("create_payment", {
    p_sale_id: creditSale.id, p_amount: 10000, p_payment_method: "mobile_money",
  });

  const { data: cfPaid } = await sbA.rpc("get_cashflow_summary", {
    p_org_id: orgA.id, p_from: null, p_to: null,
  });
  const cfP = Array.isArray(cfPaid) ? cfPaid[0] : cfPaid;
  log("N-payment_increases_cashflow",
    cfP?.total_receipts === cfA?.total_receipts + 10000,
    `receipts before=${cfA?.total_receipts} after=${cfP?.total_receipts}`);
  } // end else (creditSale exists)
  } // end else (sale exists)
  } // end else (prod exists)

  // ========================================================================
  // O. CASHFLOW MULTI-TENANT
  // ========================================================================
  console.log("\n== O. CASHFLOW MULTI-TENANT ==");
  const { data: cfOrgB } = await sbA.rpc("get_cashflow_summary", {
    p_org_id: orgB.id, p_from: null, p_to: null,
  });
  const cfBRow = Array.isArray(cfOrgB) ? cfOrgB[0] : cfOrgB;
  log("O-cashflow_multi_tenant",
    cfBRow?.total_receipts === 0,
    `orgB receipts=${cfBRow?.total_receipts} expenses=${cfBRow?.total_expenses}`);

  // ========================================================================
  // P. SUMMARY PERIOD FILTER
  // ========================================================================
  console.log("\n== P. PERIOD FILTER ==");
  const { data: sumPast } = await sbA.rpc("get_expenses_summary", {
    p_org_id: orgA.id, p_from: "2020-01-01", p_to: "2020-12-31",
  });
  log("P-summary_past_empty", sumPast && sumPast.length === 0, `count=${sumPast?.length}`);

  const { data: sumAll } = await sbA.rpc("get_expenses_summary", {
    p_org_id: orgA.id, p_from: null, p_to: null,
  });
  log("P-summary_all_data", sumAll && sumAll.length > 0, `categories=${sumAll?.length}`);

  // ========================================================================
  // Q. FIELDS COMPLETE
  // ========================================================================
  console.log("\n== Q. FIELDS ==");
  log("Q-has_category", !!readExp?.category, readExp?.category);
  log("Q-has_payment_method", !!readExp?.payment_method, readExp?.payment_method);
  log("Q-has_expense_date", !!readExp?.expense_date, readExp?.expense_date);
  log("Q-has_created_by", !!readExp?.created_by, readExp?.created_by);
  log("Q-has_organization_id", !!readExp?.organization_id, readExp?.organization_id);

  // ========================================================================
  // R. CASHFLOW FORMULA
  // ========================================================================
  console.log("\n== R. CASHFLOW FORMULA ==");
  // Use the latest cashflow data available
  const cfRef = cfP ?? { total_receipts: 0, total_expenses: 0, net_cashflow: 0 };
  const expectedNet = (cfRef.total_receipts ?? 0) - (cfRef.total_expenses ?? 0);
  log("R-cashflow_formula", cfRef.net_cashflow === expectedNet,
    `net=${cfRef.net_cashflow} expected=${expectedNet}`);

  // ========================================================================
  // SUMMARY
  // ========================================================================
  const passed = results.filter(r => r.s === "PASS").length;
  const failed = results.filter(r => r.s === "FAIL").length;
  console.log("\n========================================");
  console.log(`EXPENSES RUNTIME: ${passed}/${passed + failed} PASS, ${failed} FAIL`);
  console.log("========================================");

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
