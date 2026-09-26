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
  // Try signup first
  const { data, error } = await sb.auth.signUp({ email, password: pw });
  if (error) {
    // User exists, sign in
    const { data: si, error: siErr } = await sb.auth.signInWithPassword({ email, password: pw });
    if (siErr) throw new Error(`Auth failed: ${siErr.message}`);
    return { client: sb, userId: si.user.id };
  }
  // Signup succeeded, verify session is active
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) {
    // Session not active, sign in explicitly
    const { data: si, error: siErr } = await sb.auth.signInWithPassword({ email, password: pw });
    if (siErr) throw new Error(`Auth failed after signup: ${siErr.message}`);
    return { client: sb, userId: si.user.id };
  }
  return { client: sb, userId: data.user.id };
}

async function run() {
  const ts = Date.now();
  const emailA = `prodA.${ts}@test.dev`;
  const emailB = `prodB.${ts}@test.dev`;
  const pw = "SecureTest2024!";

  console.log("Creating users...");
  const { client: sbA, userId: userIdA } = await authUser(emailA, pw);
  const { client: sbB, userId: userIdB } = await authUser(emailB, pw);
  console.log("User A:", userIdA);
  console.log("User B:", userIdB);

  // --- Create orgs ---
  const orgAName = `OrgA_${ts}`;
  const { data: orgA } = await sbA
    .from("organizations").insert({ name: orgAName, sector: "Tech", currency: "FCFA", created_by: userIdA })
    .select("id").single();
  const orgBName = `OrgB_${ts}`;
  const { data: orgB } = await sbB
    .from("organizations").insert({ name: orgBName, sector: "Retail", currency: "FCFA", created_by: userIdB })
    .select("id").single();
  console.log("Org A:", orgA.id, "Org B:", orgB.id);

  // Debug: verify session and membership
  const { data: checkUser } = await sbA.auth.getUser();
  console.log("Session check:", checkUser.user ? `active (id=${checkUser.user.id})` : "NO SESSION");
  const { data: membership } = await sbA
    .from("organization_users").select("role").eq("organization_id", orgA.id).eq("user_id", userIdA).single();
  console.log("Membership check:", membership ? `role=${membership.role}` : "NO MEMBERSHIP");

  // ============================================================
  // A. CREATE CATEGORY
  // ============================================================
  const { data: catA1, error: catErr1 } = await sbA
    .from("categories").insert({ name: "Céréales", organization_id: orgA.id }).select("id, name").single();
  log("A-create-category", !catErr1 && catA1?.name === "Céréales", catErr1 ? catErr1.message : `id=${catA1.id}`);

  // ============================================================
  // B. READ CATEGORY
  // ============================================================
  const { data: catRead } = await sbA
    .from("categories").select("id, name").eq("id", catA1.id).single();
  log("B-read-category", catRead?.name === "Céréales", `name=${catRead?.name}`);

  // ============================================================
  // C. UPDATE CATEGORY
  // ============================================================
  const { data: catUpd, error: catUpdErr } = await sbA
    .from("categories").update({ name: "Céréales & Grains" }).eq("id", catA1.id)
    .select("name").single();
  log("C-update-category", !catUpdErr && catUpd?.name === "Céréales & Grains", catUpdErr ? catUpdErr.message : `name=${catUpd.name}`);

  // ============================================================
  // D. CREATE PRODUCT
  // ============================================================
  const { data: prodA1, error: prodErr1 } = await sbA
    .from("products").insert({
      name: "Riz 25kg", unit: "sac", cost_price: 18000, sale_price: 22000,
      min_stock_threshold: 100, category_id: catA1.id, organization_id: orgA.id
    }).select("id, name, cost_price, sale_price, is_active").single();
  log("D-create-product", !prodErr1 && prodA1?.name === "Riz 25kg" && prodA1?.is_active === true,
    prodErr1 ? prodErr1.message : `id=${prodA1.id}`);

  // Create second product (no category)
  const { data: prodA2 } = await sbA
    .from("products").insert({
      name: "Huile 5L", unit: "bidon", cost_price: 12000, sale_price: 15500,
      min_stock_threshold: 40, category_id: null, organization_id: orgA.id
    }).select("id, name").single();
  log("D-create-product-no-cat", !!prodA2?.id, `id=${prodA2?.id}`);

  // ============================================================
  // E. READ PRODUCT
  // ============================================================
  const { data: prodRead } = await sbA
    .from("products").select("id, name, cost_price, sale_price, is_active, category_id")
    .eq("id", prodA1.id).single();
  log("E-read-product", prodRead?.name === "Riz 25kg" && Number(prodRead.cost_price) === 18000,
    `name=${prodRead?.name}, cost=${prodRead?.cost_price}`);

  // ============================================================
  // F. UPDATE PRODUCT
  // ============================================================
  const { data: prodUpd, error: prodUpdErr } = await sbA
    .from("products").update({ sale_price: 23000, name: "Riz 25kg Premium" })
    .eq("id", prodA1.id).select("name, sale_price").single();
  log("F-update-product", !prodUpdErr && prodUpd?.sale_price === 23000,
    prodUpdErr ? prodUpdErr.message : `name=${prodUpd.name}, price=${prodUpd.sale_price}`);

  // ============================================================
  // G. ARCHIVE PRODUCT (set is_active = false)
  // ============================================================
  const { data: archived, error: archErr } = await sbA
    .from("products").update({ is_active: false }).eq("id", prodA2.id)
    .select("id, is_active").single();
  log("G-archive-product", !archErr && archived?.is_active === false,
    archErr ? archErr.message : `is_active=${archived.is_active}`);

  // Restore it
  await sbA.from("products").update({ is_active: true }).eq("id", prodA2.id);

  // ============================================================
  // H. USER A CANNOT SEE B's PRODUCTS
  // ============================================================
  const { data: prodB1 } = await sbB
    .from("products").insert({
      name: "Widget B", unit: "pcs", cost_price: 500, sale_price: 800,
      min_stock_threshold: 10, organization_id: orgB.id
    }).select("id").single();

  const { data: seeBfromA } = await sbA
    .from("products").select("id").eq("id", prodB1.id);
  log("H-A-cannot-see-B-products", !seeBfromA || seeBfromA.length === 0, `leaked=${seeBfromA?.length ?? 0}`);

  // ============================================================
  // I. USER B CANNOT SEE A's PRODUCTS
  // ============================================================
  const { data: seeAfromB } = await sbB
    .from("products").select("id").eq("id", prodA1.id);
  log("I-B-cannot-see-A-products", !seeAfromB || seeAfromB.length === 0, `leaked=${seeAfromB?.length ?? 0}`);

  // ============================================================
  // J. SELLER CANNOT MODIFY (RLS test: create seller user)
  // ============================================================
  const emailSeller = `seller.${ts}@test.dev`;
  const { client: sbSeller, userId: sellerId } = await authUser(emailSeller, pw);
  // Owner adds seller to Org A
  await sbA.from("organization_users").insert({ organization_id: orgA.id, user_id: sellerId, role: "seller" });
  // Seller tries to create product (should fail — RLS denies inserts for sellers)
  const { error: sellerInsertErr } = await sbSeller
    .from("products").insert({
      name: "Hacked Product", unit: "pcs", cost_price: 100, sale_price: 200, min_stock_threshold: 5,
      organization_id: orgA.id
    });
  log("J-seller-cannot-insert", !!sellerInsertErr, sellerInsertErr ? "denied by RLS" : "UNEXPECTED: insert succeeded");

  // Seller CAN read products
  const { data: sellerRead } = await sbSeller.from("products").select("id").limit(1);
  log("J-seller-can-read", !!sellerRead && sellerRead.length > 0, `read=${sellerRead?.length ?? 0} products`);

  // ============================================================
  // K. DATA PERSISTS AFTER RELOAD (new client instance)
  // ============================================================
  const sbReload = createClient(url, anon, { auth: { persistSession: false } });
  await sbReload.auth.signInWithPassword({ email: emailA, password: pw });
  const { data: reloadProd } = await sbReload
    .from("products").select("id, name").eq("id", prodA1.id).single();
  log("K-data-persists", reloadProd?.name === "Riz 25kg Premium", `name=${reloadProd?.name}`);

  // ============================================================
  // L. CONSTRAINTS: negative price, empty name, wrong org category
  // ============================================================
  // L1: negative cost_price should fail
  const { error: negCostErr } = await sbA
    .from("products").insert({
      name: "Bad Product", unit: "pcs", cost_price: -100, sale_price: 200, min_stock_threshold: 0,
      organization_id: orgA.id
    });
  log("L1-neg-cost-rejected", !!negCostErr, negCostErr ? "rejected" : "UNEXPECTED: accepted");

  // L2: negative sale_price should fail
  const { error: negSaleErr } = await sbA
    .from("products").insert({
      name: "Bad Product 2", unit: "pcs", cost_price: 100, sale_price: -50, min_stock_threshold: 0,
      organization_id: orgA.id
    });
  log("L2-neg-sale-rejected", !!negSaleErr, negSaleErr ? "rejected" : "UNEXPECTED: accepted");

  // L3: empty name should fail
  const { error: emptyNameErr } = await sbA
    .from("products").insert({
      name: "", unit: "pcs", cost_price: 100, sale_price: 200, min_stock_threshold: 0,
      organization_id: orgA.id
    });
  log("L3-empty-name-rejected", !!emptyNameErr, emptyNameErr ? "rejected" : "UNEXPECTED: accepted");

  // L4: negative min_stock_threshold should fail
  const { error: negThreshErr } = await sbA
    .from("products").insert({
      name: "Bad Product 3", unit: "pcs", cost_price: 100, sale_price: 200, min_stock_threshold: -5,
      organization_id: orgA.id
    });
  log("L4-neg-threshold-rejected", !!negThreshErr, negThreshErr ? "rejected" : "UNEXPECTED: accepted");

  // L5: duplicate category name in same org should fail
  const { error: dupCatErr } = await sbA
    .from("categories").insert({ name: "Céréales & Grains", organization_id: orgA.id });
  log("L5-dup-category-rejected", !!dupCatErr, dupCatErr ? "rejected" : "UNEXPECTED: accepted");

  // ============================================================
  // SEED: AgroDistrib products
  // ============================================================
  const { data: catCereales } = await sbA.from("categories").insert({ name: "Huiles", organization_id: orgA.id }).select("id").single();
  const { data: catBetail } = await sbA.from("categories").insert({ name: "Aliments bétail", organization_id: orgA.id }).select("id").single();
  const seedProducts = [
    { name: "Maïs 50kg", unit: "sac", cost_price: 22000, sale_price: 28000, min_stock_threshold: 50, category_id: catA1.id, organization_id: orgA.id },
    { name: "Soja 50kg", unit: "sac", cost_price: 25000, sale_price: 32000, min_stock_threshold: 30, category_id: catA1.id, organization_id: orgA.id },
    { name: "Aliment bétail 50kg", unit: "sac", cost_price: 19000, sale_price: 24000, min_stock_threshold: 25, category_id: catBetail?.id, organization_id: orgA.id },
  ];
  const { data: seeded } = await sbA.from("products").insert(seedProducts).select("id");
  log("SEED-products", seeded?.length === 3, `created=${seeded?.length}`);

  // ============================================================
  // READ PRODUCTS (final count)
  // ============================================================
  const { data: allProds } = await sbA.from("products").select("id, name").eq("is_active", true);
  log("READ-all-active-products", allProds && allProds.length >= 5, `count=${allProds?.length}`);

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("\n========== PRODUCTS TEST SUMMARY ==========");
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log(`PASSED: ${passed}/${results.length}`);
  if (failed > 0) {
    console.log("FAILURES:");
    results.filter((r) => r.status === "FAIL").forEach((r) => console.log(`  - ${r.test}: ${r.detail}`));
  }
}

run().catch((e) => { console.error("FATAL:", e); process.exit(1); });
