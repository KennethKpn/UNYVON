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
  const { data, error } = await sb.auth.signUp({ email, password: pw, options: { data: { firstName: email.split("@")[0] } } });
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
  const emailA = `delA.${ts}@2c.dev`;
  const emailS = `delS.${ts}@2c.dev`;
  const { client: sbA, userId: A } = await authUser(emailA, pw);
  const { client: sbS, userId: S } = await authUser(emailS, pw);

  const { data: org, error: eO } = await sbA.from("organizations").insert({ name: `DelOrg_${ts}`, sector: "T", currency: "FCFA", created_by: A }).select("id").single();
  log("setup-org", !eO && !!org?.id, eO?.message ?? org?.id);
  const { error: eMem } = await sbA.from("organization_users").insert({ organization_id: org.id, user_id: S, role: "seller" });
  log("setup-seller", !eMem, eMem?.message ?? "seller added");

  // Owner creates customer
  const { data: cust, error: eC } = await sbA.from("customers").insert({ organization_id: org.id, name: "DelTest", phone: "0" }).select("id").single();
  log("owner-create", !eC && !!cust?.id, eC?.message ?? cust?.id);
  const cid = cust?.id;

  // Seller attempts delete WITH select to see affected rows
  const { data: sDel, error: sErr } = await sbS.from("customers").delete().eq("id", cid).select();
  log("seller-delete-data", JSON.stringify(sDel), `rows=${sDel?.length ?? 0}, err=${sErr?.message ?? "none"}`);

  // Does the row still exist for owner?
  const { data: stillHere } = await sbA.from("customers").select("id, name").eq("id", cid).single();
  log("row-still-exists", !!stillHere, stillHere ? "YES still present" : "GONE (deleted)");

  // Owner DELETE should work (with select)
  const { data: aDel, error: aErr } = await sbA.from("customers").delete().eq("id", cid).select();
  log("owner-delete-works", aDel?.length === 1, `rows=${aDel?.length}, err=${aErr?.message ?? "none"}`);

  const passed = results.filter((r) => r.status === "PASS").length;
  console.log(`\nPASSED: ${passed}/${results.length}`);
}

run().catch((e) => { console.error("FATAL:", e); process.exit(1); });
