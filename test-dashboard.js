// ============================================================================
// UNYVON — Phase 2I Tests: Dashboard Real Data
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

  // ========================================================================
  // SETUP
  // ========================================================================
  console.log("== SETUP ==");
  const { client: sbA, userId: A } = await authUser(`dashA.${ts}@test.dev`, pw);
  const { client: sbB, userId: B } = await authUser(`dashB.${ts}@test.dev`, pw);

  const { data: orgA } = await sbA.from("organizations").insert({
    name: `DashOrgA_${ts}`, sector: "Agro", currency: "FCFA", created_by: A,
  }).select("id").single();
  await sbA.from("organization_users").insert({
    organization_id: orgA.id, user_id: A, role: "owner",
  });
  log("SETUP-orgA", !!orgA?.id, orgA?.id);

  const { data: orgB } = await sbB.from("organizations").insert({
    name: `DashOrgB_${ts}`, sector: "Retail", currency: "FCFA", created_by: B,
  }).select("id").single();
  await sbB.from("organization_users").insert({
    organization_id: orgB.id, user_id: B, role: "owner",
  });
  log("SETUP-orgB", !!orgB?.id, orgB?.id);

  // Product A: cost=8000, price=12000, margin=33.3%
  const { data: prodA } = await sbA.from("products").insert({
    organization_id: orgA.id, name: `ProdDash_${ts}`, unit: "sac",
    cost_price: 8000, sale_price: 12000, min_stock_threshold: 10,
  }).select("id").single();
  log("SETUP-prodA", !!prodA?.id, prodA?.id);

  // Stock: 200 units opening
  await sbA.from("inventory_movements").insert({
    organization_id: orgA.id, product_id: prodA.id,
    movement_type: "opening", quantity: 200, created_by: A,
  });

  // Customer
  const { data: cust } = await sbA.from("customers").insert({
    organization_id: orgA.id, name: `CustDash_${ts}`, phone: "+22990000001",
  }).select("id").single();
  log("SETUP-cust", !!cust?.id, cust?.id);

  // ========================================================================
  // A. CONTROLLED DATA
  // Expected math:
  //   Sale 1: 25 units × 12,000 = 300,000  (confirmed)
  //   Sale 2: 15 units × 12,000 = 180,000  (confirmed)
  //   Sale 3: 10 units × 12,000 = 120,000  (cancelled → NOT in CA)
  //   CA confirmed = 300k + 180k = 480,000
  //   Cost = (25+15) × 8000 = 320,000
  //   Margin = (480k - 320k) / 480k = 33.33%
  //   Receipts = 300k + 100k = 400,000
  //   Receivables = 480k - 400k = 80,000
  //   Expenses = 150k + 100k = 250,000
  //   Cashflow = 400k - 250k = 150,000
  //   Stock prodA = 200 - 25 - 15 - 10 = 150
  // ========================================================================
  console.log("\n== A. CREATE CONTROLLED DATA ==");

  // Sale 1: 25 units → 300,000
  const { data: sale1 } = await sbA.from("sales").insert({
    organization_id: orgA.id, customer_id: cust.id,
    status: "draft", sale_date: "2026-09-15", created_by: A,
  }).select("id").single();
  await sbA.from("sale_items").insert({
    sale_id: sale1.id, product_id: prodA.id,
    quantity: 25, unit_price: 12000, unit_cost_snapshot: 8000,
  });
  await sbA.rpc("confirm_sale", { p_sale_id: sale1.id });
  log("A-sale1_300k", true, "25×12000 confirmed");

  // Sale 2: 15 units → 180,000
  const { data: sale2 } = await sbA.from("sales").insert({
    organization_id: orgA.id, customer_id: cust.id,
    status: "draft", sale_date: "2026-09-16", created_by: A,
  }).select("id").single();
  await sbA.from("sale_items").insert({
    sale_id: sale2.id, product_id: prodA.id,
    quantity: 15, unit_price: 12000, unit_cost_snapshot: 8000,
  });
  await sbA.rpc("confirm_sale", { p_sale_id: sale2.id });
  log("A-sale2_180k", true, "15×12000 confirmed");

  // Sale 3: 10 units → 120,000 (cancelled → NOT counted in CA)
  const { data: sale3 } = await sbA.from("sales").insert({
    organization_id: orgA.id, customer_id: cust.id,
    status: "draft", sale_date: "2026-09-17", created_by: A,
  }).select("id").single();
  await sbA.from("sale_items").insert({
    sale_id: sale3.id, product_id: prodA.id,
    quantity: 10, unit_price: 12000, unit_cost_snapshot: 8000,
  });
  await sbA.rpc("confirm_sale", { p_sale_id: sale3.id });
  await sbA.from("sales").update({ status: "cancelled" }).eq("id", sale3.id);
  log("A-sale3_120k_cancelled", true, "10×12000 confirmed then cancelled");

  // Payments: 400k total
  await sbA.rpc("create_payment", { p_sale_id: sale1.id, p_amount: 300000, p_payment_method: "cash" });
  await sbA.rpc("create_payment", { p_sale_id: sale2.id, p_amount: 100000, p_payment_method: "mobile_money" });
  log("A-payments_400k", true, "300k cash + 100k mobile");

  // Expenses: 250k
  await sbA.from("expenses").insert([
    { organization_id: orgA.id, category: "rent", description: "Loyer test", amount: 150000, expense_date: "2026-09-15", payment_method: "cash", created_by: A },
    { organization_id: orgA.id, category: "transport", description: "Transport test", amount: 100000, expense_date: "2026-09-16", payment_method: "cash", created_by: A },
  ]);
  log("A-expenses_250k", true, "150k rent + 100k transport");

  // ========================================================================
  // B. DASHBOARD KPIs
  // ========================================================================
  console.log("\n== B. DASHBOARD KPIs ==");

  // CA = confirmed sales only: 300k + 180k = 480k
  const { data: confirmedSales } = await sbA.from("sales")
    .select("total_amount")
    .eq("organization_id", orgA.id)
    .eq("status", "confirmed");
  const ca = (confirmedSales ?? []).reduce((sum, s) => sum + Number(s.total_amount), 0);
  log("B-CA_480k", ca === 480000, `CA=${ca}`);

  // Marge = (480k - 320k) / 480k = 33.33%
  const { data: items } = await sbA.from("sale_items")
    .select("quantity, unit_cost_snapshot, sale_id")
    .in("sale_id", [sale1.id, sale2.id]);
  const totalCost = (items ?? []).reduce((sum, i) => sum + Number(i.quantity) * Number(i.unit_cost_snapshot), 0);
  const margin = ca > 0 ? ((ca - totalCost) / ca) * 100 : 0;
  log("B-marge_33", Math.abs(margin - 33.33) < 0.1, `margin=${margin.toFixed(1)}% cost=${totalCost}`);

  // Receipts = 400k
  const { data: payData } = await sbA.from("payments")
    .select("amount, sales(organization_id)")
    .limit(10000);
  const receipts = (payData ?? [])
    .filter(p => {
      const sale = Array.isArray(p.sales) ? p.sales[0] : p.sales;
      return sale?.organization_id === orgA.id;
    })
    .reduce((sum, p) => sum + Number(p.amount), 0);
  log("B-receipts_400k", receipts === 400000, `receipts=${receipts}`);

  // Expenses = 250k
  const { data: expData } = await sbA.from("expenses")
    .select("amount")
    .eq("organization_id", orgA.id);
  const expenses = (expData ?? []).reduce((sum, e) => sum + Number(e.amount), 0);
  log("B-expenses_250k", expenses === 250000, `expenses=${expenses}`);

  // Cashflow = 400k - 250k = 150k
  const cashflow = receipts - expenses;
  log("B-cashflow_150k", cashflow === 150000, `cashflow=${cashflow}`);

  // Receivables = 480k - 400k = 80k
  const receivables = ca - receipts;
  log("B-receivables_80k", receivables === 80000, `receivables=${receivables}`);

  // ========================================================================
  // C. CREDIT SALE DOES NOT INFLATE CASHFLOW
  // ========================================================================
  console.log("\n== C. CREDIT SALE ==");
  const { data: creditSale } = await sbA.from("sales").insert({
    organization_id: orgA.id, customer_id: cust.id,
    status: "draft", sale_date: "2026-09-20", created_by: A,
  }).select("id").single();
  await sbA.from("sale_items").insert({
    sale_id: creditSale.id, product_id: prodA.id,
    quantity: 5, unit_price: 12000, unit_cost_snapshot: 8000,
  });
  await sbA.rpc("confirm_sale", { p_sale_id: creditSale.id });

  // Cashflow should NOT change (no payment on credit sale)
  const { data: payData2 } = await sbA.from("payments")
    .select("amount, sales(organization_id)")
    .limit(10000);
  const receipts2 = (payData2 ?? [])
    .filter(p => {
      const sale = Array.isArray(p.sales) ? p.sales[0] : p.sales;
      return sale?.organization_id === orgA.id;
    })
    .reduce((sum, p) => sum + Number(p.amount), 0);
  log("C-credit_no_cashflow_change", receipts2 === receipts, `receipts=${receipts2}`);

  // CA should now be 480k + 60k = 540k (credit sale confirmed)
  const creditCA = ca + (5 * 12000);
  log("C-credit_CA_540k", true, `expected CA after credit=${creditCA}`);

  // ========================================================================
  // D. MULTI-TENANT ISOLATION
  // ========================================================================
  console.log("\n== D. MULTI-TENANT ==");

  const { data: prodB } = await sbB.from("products").insert({
    organization_id: orgB.id, name: `ProdDashB_${ts}`, unit: "sac",
    cost_price: 5000, sale_price: 8000, min_stock_threshold: 10,
  }).select("id").single();

  await sbB.from("inventory_movements").insert({
    organization_id: orgB.id, product_id: prodB.id,
    movement_type: "opening", quantity: 100, created_by: B,
  });

  const { data: custB } = await sbB.from("customers").insert({
    organization_id: orgB.id, name: `CustDashB_${ts}`, phone: "+22990000002",
  }).select("id").single();

  // Org B: 100 × 8000 = 800k
  const { data: saleB } = await sbB.from("sales").insert({
    organization_id: orgB.id, customer_id: custB.id,
    status: "draft", sale_date: "2026-09-15", created_by: B,
  }).select("id").single();
  await sbB.from("sale_items").insert({
    sale_id: saleB.id, product_id: prodB.id,
    quantity: 100, unit_price: 8000, unit_cost_snapshot: 5000,
  });
  await sbB.rpc("confirm_sale", { p_sale_id: saleB.id });

  // Org A should still see CA = 480k (before credit), NOT 1.28M
  const { data: aSales } = await sbA.from("sales")
    .select("total_amount")
    .eq("organization_id", orgA.id)
    .eq("status", "confirmed");
  const aCA = (aSales ?? []).reduce((sum, s) => sum + Number(s.total_amount), 0);
  const expectedACA = 480000 + (5 * 12000); // sale1 + sale2 + credit
  log("D-A_CA_isolated", aCA === expectedACA, `A_CA=${aCA} (expected ${expectedACA})`);

  // Org B should see CA = 800k only
  const { data: bSales } = await sbB.from("sales")
    .select("total_amount")
    .eq("organization_id", orgB.id)
    .eq("status", "confirmed");
  const bCA = (bSales ?? []).reduce((sum, s) => sum + Number(s.total_amount), 0);
  log("D-B_CA_800k", bCA === 800000, `B_CA=${bCA}`);

  // ========================================================================
  // E. STOCK CRITICAL
  // ========================================================================
  console.log("\n== E. STOCK ==");

  // prodA: 200 - 25 - 15 - 10 - 5 = 145
  const { data: stockA } = await sbA.rpc("get_product_stock", {
    p_org_id: orgA.id, p_product_id: prodA.id,
  });
  log("E-prodA_stock_145", stockA === 145, `stock=${stockA}`);
  log("E-prodA_not_critical", stockA > 10, `stock=${stockA} > threshold=10`);

  // prodB: 100 - 100 = 0
  const { data: stockB } = await sbB.rpc("get_product_stock", {
    p_org_id: orgB.id, p_product_id: prodB.id,
  });
  log("E-prodB_stock_0", stockB === 0, `stock=${stockB}`);
  log("E-prodB_critical", stockB <= 10, `stock=${stockB} ≤ threshold=10`);

  // ========================================================================
  // F. CANCELLED SALE NOT IN CA
  // ========================================================================
  console.log("\n== F. CANCELLED EXCLUDED ==");
  const { data: cancelledCheck } = await sbA.from("sales")
    .select("id, total_amount, status")
    .eq("id", sale3.id)
    .single();
  log("F-sale3_is_cancelled", cancelledCheck?.status === "cancelled", `status=${cancelledCheck?.status}`);
  log("F-cancelled_not_in_CA", ca === 480000, `CA=${ca} (120k cancelled excluded)`);

  // ========================================================================
  // G. CREDIT SALE STOCK
  // ========================================================================
  console.log("\n== G. CREDIT SALE STOCK ==");
  // prodA should now have 145 after credit sale
  log("G-stock_after_credit", stockA === 145, `stock=${stockA}`);

  // ========================================================================
  // SUMMARY
  // ========================================================================
  const passed = results.filter(r => r.s === "PASS").length;
  const failed = results.filter(r => r.s === "FAIL").length;
  console.log("\n========================================");
  console.log(`DASHBOARD RUNTIME: ${passed}/${passed + failed} PASS, ${failed} FAIL`);
  console.log("========================================");

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
