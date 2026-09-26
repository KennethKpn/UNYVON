const { createClient } = require("@supabase/supabase-js");

const { loadEnv } = require("./test-env");
loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const sb = createClient(url, anon, { auth: { persistSession: false } });

async function run() {
  // Try sign-in with existing user from tests
  const { data, error } = await sb.auth.signInWithPassword({
    email: "yissekpanou96@gmail.com",
    password: "password123",
  });
  console.log("Anon sign-in:", error ? `ERROR: ${error.message}` : `OK user=${data.user?.email}`);
}
run().catch((e) => console.error("FATAL", e.message));
