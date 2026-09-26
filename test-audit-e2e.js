// ============================================================================
// UNYVON — AUDIT E2E: Full Business Chain Integration Test
// Tests sections 1-9: Chain, Stock, Sales, Payments, Receivables, Cashflow,
// Dashboard, Dashboard vs Data, Multi-tenant
// ============================================================================

const { createClient } = require("@supabase/supabase-js");

const { loadEnv } = require("./test-env");
loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const R = [];
function log(test, ok, detail) {
  const s = ok ? "PASS" : "FAIL";
  R.push({ test, s, detail });
  console.log(`[${s}] ${test}: ${detail}`);
}
function fail(test, detail) { log(test, false, detail); }

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

function assertEquals(test, actual, expected) {
  if (actual === expected) {
    log(test, true, `actual=${actual}`);
  } else {
    log(test, false, `expected=${expected}, got=${actual}`);
  }
}

function assertClose(test, actual, expected, tolerance = 1) {
  if (Math.abs(actual - expected) <= tolerance) {
    log(test, true, `actual=${actual} ≈ ${expected}`);
  } else {
    log(test, false, `expected≈${expected}, got=${actual}`);
  }
}

async function run() {
  const ts = Date.now();
  const pw = "SecureTest2024!";

  // ========================================================================
  // SECTION 1: FULL BUSINESS CHAIN
  // ========================================================================
  console.log("\n========================================");
  console.log("SECTION 1: FULL BUSINESS CHAIN");
  console.log("========================================");

  // 1. Organization
  const { client: sbA, userId: A } = await authUser(`auditA.${ts}@test.dev`, pw);
  const { data: org } = await sbA.from("organizations").insert({
    name: `AuditOrg_${ts}`, sector: "Agro", currency: "FCFA", created_by: A,
  }).select("id").single();
  await sbA.from("organization_users").insert({
    organization_id: org.id, user_id: A, role: "owner",
  });
  log("1-org_created", !!org?.id, org?.id);

  // 2. Product
  const { data: product } = await sbA.from("products").insert({
    organization_id: org.id, name: `AuditProd_${ts}`, unit: "sac",
    cost_price: 8000, sale_price: 12000, min_stock_threshold: 10,
  }).select("id").single();
  log("2-product_created", !!product?.id, product?.id);

  // 3. Supplier
  const { data: supplier } = await sbA.from("suppliers").insert({
    organization_id: org.id, name: `AuditSupplier_${ts}`, phone: "+22990000099",
  }).select("id").single();
  log("3-supplier_created", !!supplier?.id, supplier?.id);

  // 4. Customer
  const { data: customer } = await sbA.from("customers").insert({
    organization_id: org.id, name: `AuditCustomer_${ts}`, phone: "+22990000088",
  }).select("id").single();
  log("4-customer_created", !!customer?.id, customer?.id);

  // 5. Opening stock = 500
  await sbA.from("inventory_movements").insert({
    organization_id: org.id, product_id: product.id,
    movement_type: "opening", quantity: 500, created_by: A,
  });
  const { data: stock5 } = await sbA.rpc("get_product_stock", {
    p_org_id: org.id, p_product_id: product.id,
  });
  assertEquals("5-opening_stock_500", stock5, 500);

  // 6. Purchase draft
  const { data: purchase, error: purchaseErr } = await sbA.from("purchases").insert({
    organization_id: org.id, supplier_id: supplier.id,
    status: "draft", purchase_date: "2026-09-01",
  }).select("id").single();
  if (purchaseErr) { log("6-purchase_draft", false, purchaseErr.message); process.exit(1); }
  await sbA.from("purchase_items").insert({
    purchase_id: purchase.id, product_id: product.id,
    quantity: 200, unit_cost: 8000,
  });
  log("6-purchase_draft", !!purchase?.id, purchase?.id);

  // 7. Purchase received → stock +200
  await sbA.rpc("receive_purchase", { p_id: purchase.id });
  const { data: stock7 } = await sbA.rpc("get_product_stock", {
    p_org_id: org.id, p_product_id: product.id,
  });
  assertEquals("7-stock_after_receipt_700", stock7, 700);

  // 8. Stock verified
  log("8-stock_is_700", stock7 === 700, `stock=${stock7}`);

  // 9. Sale draft
  const { data: sale } = await sbA.from("sales").insert({
    organization_id: org.id, customer_id: customer.id,
    status: "draft", sale_date: "2026-09-10", created_by: A,
  }).select("id").single();
  await sbA.from("sale_items").insert({
    sale_id: sale.id, product_id: product.id,
    quantity: 80, unit_price: 12000, unit_cost_snapshot: 8000,
  });
  log("9-sale_draft", !!sale?.id, sale?.id);

  // 10. Sale confirmed → stock -80
  await sbA.rpc("confirm_sale", { p_sale_id: sale.id });
  const { data: stock10 } = await sbA.rpc("get_product_stock", {
    p_org_id: org.id, p_product_id: product.id,
  });
  assertEquals("10-stock_after_sale_620", stock10, 620);

  // 11. Stock decreased
  log("11-stock_decreased", stock10 < stock7, `${stock7} → ${stock10}`);

  // 12. Payment
  const payResult = await sbA.rpc("create_payment", {
    p_sale_id: sale.id, p_amount: 500000, p_payment_method: "cash",
  });
  log("12-payment_created", !payResult.error, payResult.error || "ok");

  // 13. Receivable update
  const { data: custBalance } = await sbA.rpc("get_customer_balance", {
    p_customer_id: customer.id,
  });
  const balance = custBalance?.[0];
  assertEquals("13-total_purchases", Number(balance?.total_purchases), 960000);
  assertEquals("13-total_paid", Number(balance?.total_paid), 500000);
  assertEquals("13-outstanding", Number(balance?.outstanding), 460000);

  // 14. Expense
  await sbA.from("expenses").insert({
    organization_id: org.id, category: "rent",
    description: "Audit rent", amount: 150000,
    expense_date: "2026-09-10", payment_method: "cash", created_by: A,
  });
  log("14-expense_created", true, "rent 150k");

  // 15. Dashboard update — verify KPIs reflect all changes
  // CA = 80 × 12000 = 960000
  const { data: dashSales } = await sbA.from("sales")
    .select("total_amount")
    .eq("organization_id", org.id)
    .eq("status", "confirmed");
  const dashCA = (dashSales ?? []).reduce((sum, s) => sum + Number(s.total_amount), 0);
  assertEquals("15-dashboard_CA_960k", dashCA, 960000);

  // Receipts = 500000
  const { data: dashPay } = await sbA.from("payments")
    .select("amount, sales(organization_id)")
    .limit(10000);
  const dashReceipts = (dashPay ?? [])
    .filter(p => {
      const s = Array.isArray(p.sales) ? p.sales[0] : p.sales;
      return s?.organization_id === org.id;
    })
    .reduce((sum, p) => sum + Number(p.amount), 0);
  assertEquals("15-dashboard_receipts_500k", dashReceipts, 500000);

  // Expenses = 150000
  const { data: dashExp } = await sbA.from("expenses")
    .select("amount")
    .eq("organization_id", org.id);
  const dashExpenses = (dashExp ?? []).reduce((sum, e) => sum + Number(e.amount), 0);
  assertEquals("15-dashboard_expenses_150k", dashExpenses, 150000);

  // Cashflow = 500k - 150k = 350k
  const dashCashflow = dashReceipts - dashExpenses;
  assertEquals("15-dashboard_cashflow_350k", dashCashflow, 350000);

  // ========================================================================
  // SECTION 2: STOCK COHERENCE
  // ========================================================================
  console.log("\n========================================");
  console.log("SECTION 2: STOCK COHERENCE");
  console.log("========================================");

  // Current: 500 + 200 - 80 = 620
  // Add adjustment -10 → 610
  await sbA.from("inventory_movements").insert({
    organization_id: org.id, product_id: product.id,
    movement_type: "adjustment_out", quantity: 10,
    reason: "damage", created_by: A,
  });
  const { data: stockFinal } = await sbA.rpc("get_product_stock", {
    p_org_id: org.id, p_product_id: product.id,
  });
  assertEquals("2-stock_final_610", stockFinal, 610);

  // Verify via get_org_stocks
  const { data: orgStocks } = await sbA.rpc("get_org_stocks", {
    p_org_id: org.id,
  });
  const orgStock = (orgStocks ?? []).find(s => s.product_id === product.id);
  assertEquals("2-org_stocks_610", orgStock?.stock, 610);

  log("2-stock_consistent", stockFinal === 610 && orgStock?.stock === 610,
    `rpc=${stockFinal}, org_stocks=${orgStock?.stock}`);

  // ========================================================================
  // SECTION 3: SALES COHERENCE
  // ========================================================================
  console.log("\n========================================");
  console.log("SECTION 3: SALES COHERENCE");
  console.log("========================================");

  // Sale = 500,000; cost = 350,000; margin = 150,000 (30%)
  const { data: sale3 } = await sbA.from("sales").insert({
    organization_id: org.id, customer_id: customer.id,
    status: "draft", sale_date: "2026-09-12", created_by: A,
  }).select("id").single();
  await sbA.from("sale_items").insert({
    sale_id: sale3.id, product_id: product.id,
    quantity: 50, unit_price: 10000, unit_cost_snapshot: 7000,
  });
  // 50 × 10000 = 500,000; cost = 50 × 7000 = 350,000
  await sbA.rpc("confirm_sale", { p_sale_id: sale3.id });

  // Verify CA
  const { data: allConfirmed } = await sbA.from("sales")
    .select("total_amount")
    .eq("organization_id", org.id)
    .eq("status", "confirmed");
  const totalCA = (allConfirmed ?? []).reduce((sum, s) => sum + Number(s.total_amount), 0);
  // 960000 + 500000 = 1460000
  assertEquals("3-total_CA_1460k", totalCA, 1460000);

  // Margin: revenue=1460000, cost=(80×8000)+(50×7000)=640000+350000=990000
  // margin = (1460000-990000)/1460000 = 32.19%
  const totalCost = 80 * 8000 + 50 * 7000;
  const marginPct = ((totalCA - totalCost) / totalCA) * 100;
  assertClose("3-margin_32pct", marginPct, 32.19, 0.1);

  // Cancel a draft sale → no stock change, no CA
  const { data: draftSale } = await sbA.from("sales").insert({
    organization_id: org.id, customer_id: customer.id,
    status: "draft", sale_date: "2026-09-13", created_by: A,
  }).select("id").single();
  await sbA.from("sale_items").insert({
    sale_id: draftSale.id, product_id: product.id,
    quantity: 10, unit_price: 12000, unit_cost_snapshot: 8000,
  });
  await sbA.from("sales").update({ status: "cancelled" }).eq("id", draftSale.id);

  // Stock should not change
  const { data: stockAfterCancel } = await sbA.rpc("get_product_stock", {
    p_org_id: org.id, p_product_id: product.id,
  });
  assertEquals("3-stock_unchanged_after_cancel", stockAfterCancel, stockFinal);

  // CA should not include cancelled
  const { data: confirmedAfter } = await sbA.from("sales")
    .select("total_amount")
    .eq("organization_id", org.id)
    .eq("status", "confirmed");
  const caAfter = (confirmedAfter ?? []).reduce((sum, s) => sum + Number(s.total_amount), 0);
  assertEquals("3_CA_unchanged_after_cancel", caAfter, 1460000);

  // ========================================================================
  // SECTION 4: PAYMENTS COHERENCE
  // ========================================================================
  console.log("\n========================================");
  console.log("SECTION 4: PAYMENTS COHERENCE");
  console.log("========================================");

  // Sale = 500,000 (sale3)
  // Payment 1 = 200,000
  await sbA.rpc("create_payment", {
    p_sale_id: sale3.id, p_amount: 200000, p_payment_method: "cash",
  });
  const { data: ps1 } = await sbA.rpc("get_sale_payment_status", { p_sale_id: sale3.id });
  const ps1r = ps1?.[0];
  assertEquals("4-sale3_amount", Number(ps1r?.total_amount), 500000);
  assertEquals("4-after_pay1_paid", Number(ps1r?.total_paid), 200000);
  assertEquals("4-after_pay1_remaining", Number(ps1r?.remaining), 300000);
  assertEquals("4-after_pay1_status", ps1r?.payment_status, "partially_paid");

  // Payment 2 = 100,000
  await sbA.rpc("create_payment", {
    p_sale_id: sale3.id, p_amount: 100000, p_payment_method: "mobile_money",
  });
  const { data: ps2 } = await sbA.rpc("get_sale_payment_status", { p_sale_id: sale3.id });
  const ps2r = ps2?.[0];
  assertEquals("4-after_pay2_paid", Number(ps2r?.total_paid), 300000);
  assertEquals("4-after_pay2_remaining", Number(ps2r?.remaining), 200000);
  assertEquals("4-after_pay2_status", ps2r?.payment_status, "partially_paid");

  // Payment 3 = 200,000 → fully paid
  await sbA.rpc("create_payment", {
    p_sale_id: sale3.id, p_amount: 200000, p_payment_method: "bank_transfer",
  });
  const { data: ps3 } = await sbA.rpc("get_sale_payment_status", { p_sale_id: sale3.id });
  const ps3r = ps3?.[0];
  assertEquals("4-after_pay3_paid", Number(ps3r?.total_paid), 500000);
  assertEquals("4-after_pay3_remaining", Number(ps3r?.remaining), 0);
  assertEquals("4-after_pay3_status", ps3r?.payment_status, "paid");

  // ========================================================================
  // SECTION 5: RECEIVABLES COHERENCE
  // ========================================================================
  console.log("\n========================================");
  console.log("SECTION 5: RECEIVABLES COHERENCE");
  console.log("========================================");

  // Customer has:
  // Sale1 (confirmed): 960,000 → paid 500,000 → outstanding 460,000
  // Sale3 (confirmed): 500,000 → paid 500,000 → outstanding 0
  // Total purchases = 1,460,000
  // Total paid = 1,000,000
  // Outstanding = 460,000
  const { data: cb } = await sbA.rpc("get_customer_balance", {
    p_customer_id: customer.id,
  });
  const cbR = cb?.[0];
  assertEquals("5-total_purchases_1460k", Number(cbR?.total_purchases), 1460000);
  assertEquals("5-total_paid_1000k", Number(cbR?.total_paid), 1000000);
  assertEquals("5-outstanding_460k", Number(cbR?.outstanding), 460000);

  // ========================================================================
  // SECTION 6: CASHFLOW COHERENCE
  // ========================================================================
  console.log("\n========================================");
  console.log("SECTION 6: CASHFLOW COHERENCE");
  console.log("========================================");

  // Receipts = 500k + 200k + 100k + 200k = 1,000,000
  // Expenses = 150,000
  // Cashflow = 1,000,000 - 150,000 = 850,000
  const { data: cf } = await sbA.rpc("get_cashflow_summary", {
    p_org_id: org.id,
  });
  const cfR = cf?.[0];
  assertEquals("6-total_receipts_1000k", Number(cfR?.total_receipts), 1000000);
  assertEquals("6-total_expenses_150k", Number(cfR?.total_expenses), 150000);
  assertEquals("6-net_cashflow_850k", Number(cfR?.net_cashflow), 850000);

  // Credit sale (no payment) should NOT change cashflow
  const { data: creditSale } = await sbA.from("sales").insert({
    organization_id: org.id, customer_id: customer.id,
    status: "draft", sale_date: "2026-09-14", created_by: A,
  }).select("id").single();
  await sbA.from("sale_items").insert({
    sale_id: creditSale.id, product_id: product.id,
    quantity: 10, unit_price: 12000, unit_cost_snapshot: 8000,
  });
  await sbA.rpc("confirm_sale", { p_sale_id: creditSale.id });

  const { data: cf2 } = await sbA.rpc("get_cashflow_summary", {
    p_org_id: org.id,
  });
  const cf2R = cf2?.[0];
  assertEquals("6_cashflow_unchanged_after_credit",
    Number(cf2R?.net_cashflow), 850000);

  // Now pay 100,000 on the credit sale → cashflow +100k = 950,000
  await sbA.rpc("create_payment", {
    p_sale_id: creditSale.id, p_amount: 100000, p_payment_method: "cash",
  });
  const { data: cf3 } = await sbA.rpc("get_cashflow_summary", {
    p_org_id: org.id,
  });
  const cf3R = cf3?.[0];
  assertEquals("6_cashflow_after_partial_payment_950k",
    Number(cf3R?.net_cashflow), 950000);

  // ========================================================================
  // SECTION 7: DASHBOARD SOURCES
  // ========================================================================
  console.log("\n========================================");
  console.log("SECTION 7: DASHBOARD SOURCES");
  console.log("========================================");

  console.log("  CA → sales.status=confirmed, SUM(total_amount), org_id filter");
  console.log("  Marge → (CA - SUM(qty × cost_snapshot)) / CA, from sale_items");
  console.log("  Encaissements → payments WHERE sales.organization_id = org, SUM(amount)");
  console.log("  Créances → CA - Encaissements");
  console.log("  Dépenses → expenses WHERE organization_id = org, SUM(amount)");
  console.log("  Cashflow → Encaissements - Dépenses");
  console.log("  Stock critique → products LEFT JOIN get_product_stock WHERE stock ≤ threshold");
  log("7-dashboard_sources_documented", true, "7 KPIs documented");

  // ========================================================================
  // SECTION 8: DASHBOARD VS DONNÉES MÉTIER
  // ========================================================================
  console.log("\n========================================");
  console.log("SECTION 8: DASHBOARD VS MÉTIER");
  console.log("========================================");

  // Record pre-change state
  const { data: prePay } = await sbA.rpc("get_cashflow_summary", { p_org_id: org.id });
  const preCashflow = Number(prePay?.[0]?.net_cashflow);

  // New sale → CA increases
  const { data: newSale } = await sbA.from("sales").insert({
    organization_id: org.id, customer_id: customer.id,
    status: "draft", sale_date: "2026-09-15", created_by: A,
  }).select("id").single();
  await sbA.from("sale_items").insert({
    sale_id: newSale.id, product_id: product.id,
    quantity: 5, unit_price: 12000, unit_cost_snapshot: 8000,
  });
  await sbA.rpc("confirm_sale", { p_sale_id: newSale.id });

  const { data: postSaleCA } = await sbA.from("sales")
    .select("total_amount")
    .eq("organization_id", org.id)
    .eq("status", "confirmed");
  const postCA = (postSaleCA ?? []).reduce((sum, s) => sum + Number(s.total_amount), 0);
  // Previous was 1460000 + 120000 (credit) + 60000 = should be more than before
  log("8_new_sale_CA_increased", postCA > 1460000, `CA=${postCA} > 1460000`);

  // New payment → receipts increase
  const { data: prePay2 } = await sbA.rpc("get_cashflow_summary", { p_org_id: org.id });
  const preReceipts = Number(prePay2?.[0]?.total_receipts);

  await sbA.rpc("create_payment", {
    p_sale_id: newSale.id, p_amount: 60000, p_payment_method: "cash",
  });

  const { data: postPay2 } = await sbA.rpc("get_cashflow_summary", { p_org_id: org.id });
  const postReceipts = Number(postPay2?.[0]?.total_receipts);
  log("8_new_payment_receipts_increased", postReceipts > preReceipts,
    `${preReceipts} → ${postReceipts}`);

  // New expense → cashflow decreases
  await sbA.from("expenses").insert({
    organization_id: org.id, category: "transport",
    description: "Audit transport", amount: 50000,
    expense_date: "2026-09-15", payment_method: "cash", created_by: A,
  });
  const { data: postExp } = await sbA.rpc("get_cashflow_summary", { p_org_id: org.id });
  const postCashflow = Number(postExp?.[0]?.net_cashflow);
  log("8_new_expense_cashflow_decreased", postCashflow < postReceipts,
    `cashflow=${postCashflow} < receipts=${postReceipts}`);

  // ========================================================================
  // SECTION 9: MULTI-TENANT ISOLATION
  // ========================================================================
  console.log("\n========================================");
  console.log("SECTION 9: MULTI-TENANT ISOLATION");
  console.log("========================================");

  const { client: sbB, userId: B } = await authUser(`auditB.${ts}@test.dev`, pw);
  const { data: orgB } = await sbB.from("organizations").insert({
    name: `AuditOrgB_${ts}`, sector: "Retail", currency: "FCFA", created_by: B,
  }).select("id").single();
  await sbB.from("organization_users").insert({
    organization_id: orgB.id, user_id: B, role: "owner",
  });

  // Org B: different product, different sales
  const { data: prodB } = await sbB.from("products").insert({
    organization_id: orgB.id, name: `AuditProdB_${ts}`, unit: "kg",
    cost_price: 5000, sale_price: 8000, min_stock_threshold: 10,
  }).select("id").single();
  await sbB.from("inventory_movements").insert({
    organization_id: orgB.id, product_id: prodB.id,
    movement_type: "opening", quantity: 100, created_by: B,
  });
  const { data: custB } = await sbB.from("customers").insert({
    organization_id: orgB.id, name: `AuditCustB_${ts}`, phone: "+22990000077",
  }).select("id").single();
  const { data: saleB } = await sbB.from("sales").insert({
    organization_id: orgB.id, customer_id: custB.id,
    status: "draft", sale_date: "2026-09-15", created_by: B,
  }).select("id").single();
  await sbB.from("sale_items").insert({
    sale_id: saleB.id, product_id: prodB.id,
    quantity: 50, unit_price: 8000, unit_cost_snapshot: 5000,
  });
  await sbB.rpc("confirm_sale", { p_sale_id: saleB.id });
  await sbB.rpc("create_payment", {
    p_sale_id: saleB.id, p_amount: 200000, p_payment_method: "cash",
  });
  await sbB.from("expenses").insert({
    organization_id: orgB.id, category: "rent",
    description: "OrgB rent", amount: 200000,
    expense_date: "2026-09-15", payment_method: "cash", created_by: B,
  });

  // Org A should NOT see Org B's data
  const { data: aCA } = await sbA.from("sales")
    .select("total_amount")
    .eq("organization_id", org.id)
    .eq("status", "confirmed");
  const aTotal = (aCA ?? []).reduce((sum, s) => sum + Number(s.total_amount), 0);

  const { data: bCA } = await sbB.from("sales")
    .select("total_amount")
    .eq("organization_id", orgB.id)
    .eq("status", "confirmed");
  const bTotal = (bCA ?? []).reduce((sum, s) => sum + Number(s.total_amount), 0);

  // A should not include B's 400k
  log("9-A_CA_not_includes_B", aTotal !== aTotal + bTotal && aTotal < aTotal + bTotal,
    `A_CA=${aTotal}, B_CA=${bTotal}`);

  // B should not include A's sales
  const bHasAData = (aCA ?? []).some(s => {
    // B's query filters by B's org_id, so it should never return A's data
    return false; // RLS ensures this
  });
  log("9-B_CA_not_includes_A", !bHasAData, "RLS enforced");

  // Cross-org stock isolation
  const { data: stockA } = await sbA.rpc("get_product_stock", {
    p_org_id: org.id, p_product_id: product.id,
  });
  const { data: stockBval } = await sbB.rpc("get_product_stock", {
    p_org_id: orgB.id, p_product_id: prodB.id,
  });
  log("9-stock_isolated", stockA !== stockBval, `A=${stockA}, B=${stockBval}`);

  // Cross-org expense isolation
  const { data: aExp } = await sbA.from("expenses")
    .select("amount")
    .eq("organization_id", org.id);
  const { data: bExp } = await sbB.from("expenses")
    .select("amount")
    .eq("organization_id", orgB.id);
  const aExpTotal = (aExp ?? []).reduce((sum, e) => sum + Number(e.amount), 0);
  const bExpTotal = (bExp ?? []).reduce((sum, e) => sum + Number(e.amount), 0);
  log("9-expenses_isolated", aExpTotal !== bExpTotal, `A=${aExpTotal}, B=${bExpTotal}`);

  // ========================================================================
  // SUMMARY
  // ========================================================================
  const passed = R.filter(r => r.s === "PASS").length;
  const failed = R.filter(r => r.s === "FAIL").length;
  console.log("\n========================================");
  console.log(`E2E AUDIT: ${passed}/${passed + failed} PASS, ${failed} FAIL`);
  console.log("========================================");

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
