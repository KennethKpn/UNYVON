const { randomUUID } = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const { loadEnv } = require("./test-env");
loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const BUCKET = "imports";

// ============================================================================
// Verification RUNTIME de la suppression d'un objet Storage Smart Data Import.
// Complementaire a supabase/verify-import-storage.sql, qui ne peut PAS couvrir
// ce point : Supabase interdit le DELETE direct sur storage.objects
// ("Direct deletion from storage tables is not allowed. Use the Storage API
// instead."). La seule voie reelle est la Storage API .remove([...]), celle
// qu'utilise deleteImportDocument() apres suppression de la row.
//
// Regles non negociables :
//   - contexte `authenticated` uniquement ; service_role contournerait la RLS
//     et ne prouverait rien sur le comportement reel de l'application ;
//   - aucun DELETE SQL sur storage.objects, aucun contournement ;
//   - scenario positif (row PUIS objet, aucun orphelin) + controle negatif
//     cross-tenant (un autre utilisateur ne peut ni supprimer l'objet ni la row).
// ============================================================================

const results = [];
function log(test, ok, detail) {
  const status = ok ? "PASS" : "FAIL";
  results.push({ test, status, detail });
  console.log(`[${status}] ${test}: ${detail}`);
}

const PUBLISHABLE_PREFIX = "sb_publishable_";
const SECRET_PREFIX = "sb_secret_";

// Fail-closed : n'accepte que les formes explicitement publiques
// (cle moderne sb_publishable_*, ou ancien JWT public de role anon/authenticated).
// Ne journalise jamais la cle : seuls des noms de roles sont rapportes, et
// seulement s'ils sont des jetons simples (aucun fragment de credential).
function resolvePublicKeyRole(key) {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("Cle publique Supabase absente ou vide (voir test-env.js) : test interrompu.");
  }
  if (key.startsWith(SECRET_PREFIX)) {
    throw new Error(
      "Cle utilisee = cle secrete Supabase (sb_secret_*) : test sans valeur, la RLS serait contournee. Utiliser la cle publique.",
    );
  }
  if (key.startsWith(PUBLISHABLE_PREFIX)) {
    // Cle publique moderne : pas un JWT, donc aucun claim 'role' a lire.
    return "sb_publishable";
  }

  const segments = key.split(".");
  if (segments.length !== 3 || segments.some((segment) => segment.length === 0)) {
    throw new Error(
      "Format de cle Supabase inconnu (ni cle publique sb_publishable_*, ni JWT a 3 segments) : test interrompu.",
    );
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("Payload JWT de la cle publique illisible : test interrompu.");
  }

  const role = payload?.role;
  if (typeof role !== "string" || role.length === 0) {
    throw new Error("JWT sans claim 'role' lisible : test interrompu.");
  }
  if (role === "service_role") {
    throw new Error(
      "Cle utilisee = service_role : test sans valeur, la RLS serait contournee. Utiliser la cle publique.",
    );
  }
  if (role !== "anon" && role !== "authenticated") {
    const reported = /^[a-z_]{1,32}$/.test(role) ? ` (trouve : '${role}')` : "";
    throw new Error(
      `Role JWT inattendu pour ce test${reported} : seules 'anon' et 'authenticated' sont acceptees.`,
    );
  }
  return role;
}

function assertAuthenticatedContext() {
  if (!url || !anon) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY absents (voir test-env.js)",
    );
  }
  const role = resolvePublicKeyRole(anon);
  console.log(`Contexte : cle publique '${role}' (aucun privilege service), clients signes en 'authenticated'.`);
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

async function createImportFixture(sb, userId, ts, tag) {
  const { data: org, error: orgErr } = await sb
    .from("organizations")
    .insert({ name: `Org_${tag}_${ts}`, sector: "Tech", currency: "FCFA", created_by: userId })
    .select("id")
    .single();
  if (orgErr) throw new Error(`Org ${tag}: ${orgErr.message}`);

  const { data: session, error: sesErr } = await sb
    .from("import_sessions")
    .insert({ organization_id: org.id, created_by: userId })
    .select("id")
    .single();
  if (sesErr) throw new Error(`Session ${tag}: ${sesErr.message}`);

  const documentId = randomUUID();
  const fileName = "notes.md";
  const storagePath = `organizations/${org.id}/imports/${session.id}/documents/${documentId}/${fileName}`;
  const body = `# fixture ${tag}\nverifie la suppression row puis objet via la Storage API.\n`;
  const buffer = Buffer.from(body, "utf8");

  const { data: doc, error: docErr } = await sb
    .from("import_documents")
    .insert({
      id: documentId,
      session_id: session.id,
      organization_id: org.id,
      original_name: fileName,
      source_kind: "md",
      mime_type: "text/markdown",
      size_bytes: buffer.length,
      storage_path: storagePath,
      state: "uploading",
    })
    .select("id, storage_path, state")
    .single();
  if (docErr) throw new Error(`Document ${tag}: ${docErr.message}`);

  const { error: upErr } = await sb.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: "text/markdown", upsert: false });
  if (upErr) throw new Error(`Upload ${tag}: ${upErr.message}`);

  return { orgId: org.id, sessionId: session.id, documentId: doc.id, storagePath, body };
}

async function objectExists(sb, storagePath) {
  const folder = storagePath.slice(0, storagePath.lastIndexOf("/"));
  const { data, error } = await sb.storage.from(BUCKET).list(folder, { limit: 100 });
  if (error) return null;
  return (data ?? []).some((f) => f.name === storagePath.split("/").pop());
}

async function run() {
  assertAuthenticatedContext();

  const ts = Date.now();
  const pw = "SecureTest2024!";
  const emailA = `storageA.${ts}@test.dev`;
  const emailB = `storageB.${ts}@test.dev`;

  console.log("Creating User A (owner of the fixture)...");
  const { client: sbA, userId: userIdA } = await authUser(emailA, pw);
  console.log("Creating User B (other tenant, negative control)...");
  const { client: sbB } = await authUser(emailB, pw);

  const a = await createImportFixture(sbA, userIdA, ts, "A");

  try {
    // --- Fixture en place --------------------------------------------------
    log("SETUP-upload-via-Storage-API", (await objectExists(sbA, a.storagePath)) === true, a.storagePath);

    const { data: beforeRow } = await sbA
      .from("import_documents")
      .select("id")
      .eq("id", a.documentId)
      .maybeSingle();
    log("SETUP-row-present", beforeRow?.id === a.documentId, `row=${beforeRow?.id ?? "absente"}`);

    // --- Controle negatif AVANT suppression : B ne peut pas toucher l'objet --
    // La Storage API peut renvoyer un succes SANS erreur alors que la RLS a
    // filtre la suppression (aucune ligne concernee). Le seul critere de
    // securite fiable est donc l'ETAT de l'objet apres la tentative, pas le
    // code retour : objet toujours present = PASS, disparu = FAIL, et lecture
    // en erreur = controle non concluant (fail-closed).
    const { error: bRemoveErr } = await sbB.storage.from(BUCKET).remove([a.storagePath]);
    const stateAfterB = await objectExists(sbA, a.storagePath);
    const apiReport = bRemoveErr
      ? `erreur « ${bRemoveErr.message} »`
      : "aucune erreur retournee (RLS filtree la suppression)";
    let detailAfterB;
    if (stateAfterB === true) {
      detailAfterB = `objet conserve, API B : ${apiReport}`;
    } else if (stateAfterB === false) {
      detailAfterB = `objet SUPPRIME par le tenant B — fuite !, API B : ${apiReport}`;
    } else {
      detailAfterB = `controle non concluant (lecture en erreur), API B : ${apiReport}`;
    }
    log("NEG-B-cannot-remove-A-object", stateAfterB === true, detailAfterB);

    const { data: bRowDelete } = await sbB
      .from("import_documents")
      .delete()
      .eq("id", a.documentId)
      .select();
    log(
      "NEG-B-cannot-delete-A-row",
      !bRowDelete || bRowDelete.length === 0,
      `lignes supprimees=${bRowDelete?.length ?? 0}`,
    );

    // --- Scenario positif : ordre row PUIS objet (deleteImportDocument) ----
    const { data: deleted, error: rowErr } = await sbA
      .from("import_documents")
      .delete()
      .eq("id", a.documentId)
      .select("id");
    log(
      "POS-row-deleted-by-owner",
      !rowErr && deleted?.length === 1,
      rowErr ? rowErr.message : `lignes supprimees=${deleted?.length ?? 0}`,
    );

    const { data: afterRow, error: listAfterRow } = await sbA.storage
      .from(BUCKET)
      .list(a.storagePath.slice(0, a.storagePath.lastIndexOf("/")), { limit: 100 });
    log(
      "POS-object-still-there-after-row-delete",
      !listAfterRow && (afterRow ?? []).some((f) => f.name === a.storagePath.split("/").pop()),
      `presents=${(afterRow ?? []).length} (l'objet doit survivre a la row : le DELETE policy ne doit pas dependre d'elle)`,
    );

    // Point central : .remove([...]) doit reussir ALORS QUE la row n'existe plus.
    const { error: removeErr } = await sbA.storage.from(BUCKET).remove([a.storagePath]);
    log(
      "POS-remove-via-Storage-API-after-row-delete",
      !removeErr,
      removeErr ? `ECHEC (${removeErr.message})` : "objet supprime par la Storage API",
    );

    const stillThere = await objectExists(sbA, a.storagePath);
    log("POS-no-orphan-object", stillThere === false, `objet encore present=${stillThere}`);

    const { data: rowAfter } = await sbA
      .from("import_documents")
      .select("id")
      .eq("id", a.documentId)
      .maybeSingle();
    log("POS-no-orphan-row", rowAfter === null, `row=${rowAfter?.id ?? "absente"}`);
  } finally {
    // --- Nettoyage (l'echec du scenario ne doit pas laisser d'orphelin) -----
    await sbA.storage.from(BUCKET).remove([a.storagePath]);
    await sbA.from("import_sessions").delete().eq("id", a.sessionId);
    await sbA.from("organizations").delete().eq("id", a.orgId);
    console.log("Nettoyage effectue (session + organisation cascades).");
  }

  console.log("\n========== STORAGE DELETE RUNTIME SUMMARY ==========");
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log(`PASSED: ${passed}/${results.length}`);
  if (failed > 0) {
    console.log("FAILURES:");
    results.filter((r) => r.status === "FAIL").forEach((r) => console.log(`  - ${r.test}: ${r.detail}`));
    process.exitCode = 1;
  }
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});