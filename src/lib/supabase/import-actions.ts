"use server";

import { randomUUID } from "node:crypto";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveMemberOrg, resolveOwnedOrg } from "@/lib/supabase/org-resolve";
import {
  addImportDocumentSchema,
  buildImportStoragePath,
  canTransitionImportDocument,
  importFieldsSchema,
  canTransitionImportSession,
  importStoragePathSchema,
  uuidSchema,
} from "@/lib/import/schemas";
import {
  IMPORT_TARGET_FIELDS,
  type DatabaseImportDocument,
  type DatabaseImportSession,
  type DatabaseImportItem,
  type ImportDocumentState,
  type ImportFieldProvenance,
} from "@/lib/import/types";
import {
  createDefaultProvider,
  createDocumentExtractor,
  type ExtractedDocument,
} from "@/lib/import/extraction";
import type { z } from "zod";
import { proposeImportItemMatch, type ExistingImportEntity } from "@/lib/import/matching";

type AddImportDocumentInput = z.infer<typeof addImportDocumentSchema>;

type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;

// États depuis lesquels la suppression d'un document est sûre :
// tant que rien n'a été extrait ni importé, rien n'est irréversible.
const DELETABLE_DOCUMENT_STATES: readonly ImportDocumentState[] = [
  "uploading",
  "uploaded",
  "failed",
];

// ---------------------------------------------------------------------------
// Guards (convention : auth → rôle owner/manager, messages français)
// ---------------------------------------------------------------------------

async function requireAuth(supabase: ServerSupabase): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");
  return user.id;
}

async function requireManagerRole(
  supabase: ServerSupabase,
  organizationId: string
): Promise<void> {
  const { data: role } = await supabase.rpc("current_org_role", {
    org_id: organizationId,
  });
  if (role !== "owner" && role !== "manager") {
    throw new Error(
      "Seuls les propriétaires et managers peuvent gérer les imports"
    );
  }
}

async function fetchSession(
  supabase: ServerSupabase,
  sessionId: string
): Promise<DatabaseImportSession> {
  const { data, error } = await supabase
    .from("import_sessions")
    .select("*")
    .eq("id", sessionId)
    .limit(1);
  if (error) {
    throw new Error(`Erreur lecture session d'import: ${error.message}`);
  }
  const session = (data ?? [])[0] as DatabaseImportSession | undefined;
  if (!session) throw new Error("Session d'import introuvable");
  return session;
}

async function fetchDocument(
  supabase: ServerSupabase,
  documentId: string
): Promise<DatabaseImportDocument> {
  const { data, error } = await supabase
    .from("import_documents")
    .select("*")
    .eq("id", documentId)
    .limit(1);
  if (error) {
    throw new Error(`Erreur lecture document d'import: ${error.message}`);
  }
  const document = (data ?? [])[0] as DatabaseImportDocument | undefined;
  if (!document) throw new Error("Document d'import introuvable");
  return document;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

// L'org n'est JAMAIS un paramètre du navigateur : elle est dérivée côté
// serveur de l'identité authentifiée (org créée, sinon org membre).
export async function createImportSession(): Promise<DatabaseImportSession> {
  const supabase = await createServerSupabase();
  const userId = await requireAuth(supabase);

  const organizationId =
    (await resolveOwnedOrg(supabase, userId)) ??
    (await resolveMemberOrg(supabase, userId));
  if (!organizationId) {
    throw new Error("Aucune organisation");
  }
  await requireManagerRole(supabase, organizationId);

  const { data, error } = await supabase
    .from("import_sessions")
    .insert({
      organization_id: organizationId,
      created_by: userId,
      state: "collecting",
    })
    .select()
    .single();
  if (error) {
    throw new Error(`Erreur création session d'import: ${error.message}`);
  }
  return data as DatabaseImportSession;
}

export async function getImportSessions(): Promise<DatabaseImportSession[]> {
  const supabase = await createServerSupabase();
  await requireAuth(supabase);

  const { data, error } = await supabase
    .from("import_sessions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`Erreur sessions d'import: ${error.message}`);
  }
  return (data ?? []) as DatabaseImportSession[];
}

export async function getImportSession(
  sessionId: string
): Promise<DatabaseImportSession | null> {
  const supabase = await createServerSupabase();
  await requireAuth(supabase);

  const { data, error } = await supabase
    .from("import_sessions")
    .select("*")
    .eq("id", sessionId)
    .limit(1);
  if (error) {
    throw new Error(`Erreur lecture session d'import: ${error.message}`);
  }
  return ((data ?? [])[0] as DatabaseImportSession | undefined) ?? null;
}

export async function cancelImportSession(
  sessionId: string
): Promise<DatabaseImportSession> {
  const supabase = await createServerSupabase();
  await requireAuth(supabase);

  const session = await fetchSession(supabase, sessionId);
  await requireManagerRole(supabase, session.organization_id);

  if (!canTransitionImportSession(session.state, "cancelled")) {
    throw new Error(
      `Transition d'état non autorisée (${session.state} → cancelled)`
    );
  }

  const { data, error } = await supabase
    .from("import_sessions")
    .update({ state: "cancelled" })
    .eq("id", sessionId)
    .select()
    .single();
  if (error) {
    throw new Error(`Erreur annulation session d'import: ${error.message}`);
  }
  return data as DatabaseImportSession;
}

// ---------------------------------------------------------------------------
// Documents (collecte)
// ---------------------------------------------------------------------------

// Métadonnées déclarées AVANT upload : originalName/sourceKind/mimeType/
// sizeBytes validés ici (zod, cohérence extension↔MIME↔source_kind) mais non
// vérifiables sur les octets — l'upload va directement navigateur → Storage.
// Garanties par niveau (client / Storage / à vérifier après) : documentation
// dans docs/IMPORT_STORAGE_INTEGRITY.md § 3.
export async function addImportDocument(
  input: AddImportDocumentInput
): Promise<{ document: DatabaseImportDocument; storagePath: string }> {
  const parsed = addImportDocumentSchema.parse(input);
  const supabase = await createServerSupabase();
  await requireAuth(supabase);

  const session = await fetchSession(supabase, parsed.sessionId);
  await requireManagerRole(supabase, session.organization_id);

  if (session.state !== "collecting") {
    throw new Error(
      "Les documents ne peuvent être ajoutés qu'en phase de collecte"
    );
  }

  const documentId = randomUUID();
  const storagePath = buildImportStoragePath(
    session.organization_id,
    session.id,
    documentId,
    parsed.originalName
  );

  const { data, error } = await supabase
    .from("import_documents")
    .insert({
      id: documentId,
      session_id: session.id,
      organization_id: session.organization_id,
      original_name: parsed.originalName,
      source_kind: parsed.sourceKind,
      mime_type: parsed.mimeType,
      size_bytes: parsed.sizeBytes,
      storage_path: storagePath,
      state: "uploading",
    })
    .select()
    .single();
  if (error) throw new Error(`Erreur ajout document: ${error.message}`);

  return { document: data as DatabaseImportDocument, storagePath };
}

// Passe à 'uploaded' = FERME la fenêtre d'upload de 0012 (insert/update de
// l'objet_storage become refusés) et OUVRE l'extraction. Sans vérification de
// l'objet, un simple appel client suffirait à obtenir un document 'uploaded'
// sans un seul octet stocké : extraction sur un objet absent, et contenu
// devenu immuable donc plus rattrapable. La transition est donc subordonnée à
// la PRÉSENCE RÉELLE de l'objet au chemin EXACT du document.
export async function markImportDocumentUploaded(
  documentId: string
): Promise<DatabaseImportDocument> {
  const supabase = await createServerSupabase();
  await requireAuth(supabase);

  const document = await fetchDocument(supabase, documentId);
  await requireManagerRole(supabase, document.organization_id);

  if (!canTransitionImportDocument(document.state, "uploaded")) {
    throw new Error(
      `Transition d'état non autorisée (${document.state} → uploaded)`
    );
  }

  // Après le graphe d'états (erreur d'état attendue prioritaire sur l'I/O) et
  // avant toute mutation : rien n'est écrit si l'objet est absent.
  await assertStorageObjectExists(supabase, document);

  const { data, error } = await supabase
    .from("import_documents")
    .update({ state: "uploaded" })
    .eq("id", documentId)
    .select()
    .single();
  if (error) {
    throw new Error(`Erreur mise à jour document: ${error.message}`);
  }
  return data as DatabaseImportDocument;
}

// Liste le dossier du document (organizations/{org}/imports/{sid}/documents/
// {doc}) et exige un fichier dont le nom est EXACTEMENT celui du document.
// `list` est soumis à la policy imports_select_owner_manager (RLS) : un objet
// hors périmètre n'est simplement pas visible, donc jamais compté comme présent.
// Le filtre exact (et non un simple `search`) évite les faux positifs d'un
// nom partageant un préfixe, ainsi qu'un faux négatif sur un homonyme.
async function assertStorageObjectExists(
  supabase: ServerSupabase,
  document: DatabaseImportDocument
): Promise<void> {
  assertOwnedStoragePath(document);

  const slash = document.storage_path.lastIndexOf("/");
  const folder = document.storage_path.slice(0, slash);
  const fileName = document.storage_path.slice(slash + 1);

  const { data, error } = await supabase.storage
    .from("imports")
    .list(folder, { search: fileName });
  if (error) {
    throw new Error(`Erreur vérification objet Storage: ${error.message}`);
  }

  // `id` non nul = fichier ; un dossier porterait id = null.
  const present = (data ?? []).some(
    (entry) => entry.name === fileName && typeof entry.id === "string"
  );
  if (!present) {
    throw new Error(
      "Objet Storage absent : l'upload du document n'a pas abouti, la transition vers 'uploaded' est refusée"
    );
  }
}

export async function markImportDocumentUploadFailed(
  documentId: string,
  errorMessage: string
): Promise<DatabaseImportDocument> {
  const supabase = await createServerSupabase();
  await requireAuth(supabase);

  const document = await fetchDocument(supabase, documentId);
  await requireManagerRole(supabase, document.organization_id);

  if (!canTransitionImportDocument(document.state, "failed")) {
    throw new Error(
      `Transition d'état non autorisée (${document.state} → failed)`
    );
  }

  const { data, error } = await supabase
    .from("import_documents")
    .update({ state: "failed", error_message: errorMessage })
    .eq("id", documentId)
    .select()
    .single();
  if (error) {
    throw new Error(`Erreur mise à jour document: ${error.message}`);
  }
  return data as DatabaseImportDocument;
}

// Suppression document — aucun lien transactionnel PostgreSQL ↔ Storage.
// Ordre choisi (compensation explicite) :
//   1. pré-vérifications (auth, rôle, état, chemin Storage) — aucune mutation ;
//   2. suppression de la row import_documents (source de vérité) ;
//   3. suppression de l'objet Storage.
// Si (3) échoue → compensation : la row complète est réinsérée (lue en 1) et
// l'erreur est retournée ; l'état « row + objet » est restauré et la
// suppression devient rejouable. Si la réinsertion échoue aussi (double
// panne), l'objet peut rester orphelin : l'erreur porte le chemin pour le
// nettoyage. L'ordre inverse (Storage d'abord) est rejeté : un échec
// PostgreSQL détruirait alors un fichier encore référencé, sans compensation
// possible (son contenu n'est pas reconstituable).
export async function deleteImportDocument(documentId: string): Promise<void> {
  const supabase = await createServerSupabase();
  await requireAuth(supabase);

  const document = await fetchDocument(supabase, documentId);
  await requireManagerRole(supabase, document.organization_id);

  if (!DELETABLE_DOCUMENT_STATES.includes(document.state)) {
    throw new Error("Suppression non autorisée pour cet état du document");
  }
  assertOwnedStoragePath(document);

  const { error } = await supabase
    .from("import_documents")
    .delete()
    .eq("id", documentId);
  if (error) {
    // Échec avant toute mutation : l'objet Storage est intact.
    throw new Error(`Erreur suppression document: ${error.message}`);
  }

  const { error: storageError } = await supabase.storage
    .from("imports")
    .remove([document.storage_path]);
  if (!storageError) return;

  const { error: restoreError } = await supabase
    .from("import_documents")
    .insert(document);
  if (!restoreError) {
    throw new Error(
      `Objet Storage non supprimé (${storageError.message}) : document restauré, suppression à rejouer`
    );
  }
  throw new Error(
    `Objet Storage orphelin possible [${document.storage_path}] : suppression échouée (${storageError.message}) et restauration impossible (${restoreError.message})`
  );
}

// N'efface que l'objet appartenant À CE document : chemin conforme à la
// structure imposée par les policies et segments org/session/document identiques
// à ceux de la row (jamais un chemin lu « au hasard »).
function assertOwnedStoragePath(document: DatabaseImportDocument): void {
  const prefix = `organizations/${document.organization_id}/imports/${document.session_id}/documents/${document.id}/`;
  const valid =
    importStoragePathSchema.safeParse(document.storage_path).success &&
    document.storage_path.startsWith(prefix);
  if (!valid) {
    throw new Error("Chemin Storage du document invalide");
  }
}

export async function getImportDocuments(
  sessionId: string
): Promise<DatabaseImportDocument[]> {
  const supabase = await createServerSupabase();
  await requireAuth(supabase);

  const { data, error } = await supabase
    .from("import_documents")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(`Erreur documents d'import: ${error.message}`);
  }
  return (data ?? []) as DatabaseImportDocument[];
}

// ---------------------------------------------------------------------------
// Extraction (Phase 4) — Storage → lecture → extraction → structure validée.
// Lecture seule : aucune écriture DB, aucune mutation d'état.
//
// Précondition d'état : 'uploaded' EXACTEMENT. L'extraction ne doit jamais
// transformer un document en cours d'upload ('uploading') ni un document
// terminal ('failed', 'extracted'…) : le seul état dont on sait que l'objet
// existe et que son contenu est figé est 'uploaded'. Ce contrôle est placé
// AVANT le téléchargement et avant toute instanciation de provider : aucun
// octet n'est lu et aucun appel IA n'est émis pour un document non éligible
// (pas de coût, pas de surface d'injection).
async function performImportDocumentExtraction(
  supabase: ServerSupabase,
  document: DatabaseImportDocument
): Promise<ExtractedDocument> {
  const { data: blob, error } = await supabase.storage
    .from("imports")
    .download(document.storage_path);
  if (error || !blob) {
    throw new Error(
      `Erreur téléchargement document: ${error?.message ?? "objet introuvable"}`
    );
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const extractor = createDocumentExtractor({
    provider: createDefaultProvider(),
  });
  return extractor.extract({
    documentId: document.id,
    sourceKind: document.source_kind,
    filename: document.original_name,
    bytes,
  });
}

// Phase 5A : extraction validée -> import_items.
// La DB reste l'autorité de rattachement org/session/document.
// La finalisation SQL est idempotente : un second appel après extracted
// retourne les lignes existantes au lieu de les recréer.
export async function extractImportDocument(
  documentId: string
): Promise<ExtractedDocument> {
  const parsedId = uuidSchema.safeParse(documentId);
  if (!parsedId.success) throw new Error("Identifiant document invalide");

  const supabase = await createServerSupabase();
  await requireAuth(supabase);

  const document = await fetchDocument(supabase, documentId);
  await requireManagerRole(supabase, document.organization_id);

  if (document.state !== "uploaded") {
    throw new Error(
      `Extraction autorisée uniquement depuis l'état 'uploaded' (état actuel : ${document.state})`
    );
  }

  return performImportDocumentExtraction(supabase, document);
}

// Démarre le traitement d'une session uniquement lorsque tous les documents
// présents sont réellement uploaded. Le double clic est idempotent : processing
// est simplement renvoyé.
export async function startImportProcessing(
  sessionId: string
): Promise<DatabaseImportSession> {
  uuidSchema.parse(sessionId);

  const supabase = await createServerSupabase();
  await requireAuth(supabase);

  const session = await fetchSession(supabase, sessionId);
  await requireManagerRole(supabase, session.organization_id);

  if (session.state === "processing") return session;
  if (session.state !== "collecting") {
    throw new Error(
      `Démarrage du traitement non autorisé depuis l'état ${session.state}`
    );
  }

  const { data: documents, error: documentsError } = await supabase
    .from("import_documents")
    .select("id, state")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (documentsError) {
    throw new Error(
      `Erreur lecture documents avant traitement: ${documentsError.message}`
    );
  }

  const rows = documents ?? [];
  if (rows.length === 0) {
    throw new Error("Impossible de traiter une session sans document");
  }

  // Un ou plusieurs documents peuvent être déjà en échec : ils restent
  // visibles et relançables, mais ne doivent pas empêcher le traitement des
  // autres fichiers correctement téléversés.
  if (!rows.some((row) => row.state === "uploaded")) {
    throw new Error("Aucun document prêt à traiter : relancez ou ajoutez un fichier.");
  }

  const { data, error } = await supabase
    .from("import_sessions")
    .update({ state: "processing" })
    .eq("id", sessionId)
    .eq("state", "collecting")
    .select()
    .single();

  if (!error) return data as DatabaseImportSession;

  const latest = await fetchSession(supabase, sessionId);
  if (latest.state === "processing") return latest;

  throw new Error(
    `Erreur démarrage du traitement d'import: ${error.message}`
  );
}

export async function extractionDiagnostics(extracted: ExtractedDocument): Promise<string> {
  const pages = extracted.pages.length;
  const characters = extracted.pages.reduce((total, page) => total + page.text.length, 0);

  if (extracted.source === "image-llm") {
    return "Lecture image : analyse multimodale non finalisée.";
  }

  if (pages > 0) {
    return `Lecture locale réussie : ${pages} page${pages > 1 ? "s" : ""}, ${characters.toLocaleString("fr-FR")} caractères. La structuration des données n'a pas abouti.`;
  }

  if (extracted.source === "pdf-llm") {
    return "Lecture locale du PDF : aucun texte exploitable. Le fallback visuel IA n'a pas abouti.";
  }

  return "Lecture locale : aucun contenu exploitable.";
}

export async function materializeImportDocument(
  documentId: string
): Promise<DatabaseImportItem[]> {
  uuidSchema.parse(documentId);

  const supabase = await createServerSupabase();
  await requireAuth(supabase);

  const document = await fetchDocument(supabase, documentId);
  await requireManagerRole(supabase, document.organization_id);

  const session = await fetchSession(supabase, document.session_id);
  if (session.state !== "processing" && session.state !== "needs_review") {
    throw new Error(
      `Matérialisation autorisée pendant le traitement/review uniquement (session: ${session.state})`
    );
  }

  if (document.state === "extracted") {
    const { data: existing, error: existingError } = await supabase
      .from("import_items")
      .select("*")
      .eq("document_id", document.id)
      .order("created_at", { ascending: true });

    if (existingError) {
      throw new Error(
        `Erreur lecture items déjà matérialisés: ${existingError.message}`
      );
    }
    return (existing ?? []) as DatabaseImportItem[];
  }

  if (document.state !== "uploaded") {
    throw new Error(
      `Matérialisation autorisée uniquement depuis 'uploaded' (état actuel : ${document.state})`
    );
  }

  let extracted: ExtractedDocument;
  try {
    extracted = await performImportDocumentExtraction(supabase, document);
  } catch (error) {
    const message = (error as Error).message;
    await supabase
      .from("import_documents")
      .update({ state: "failed", error_message: message })
      .eq("id", document.id)
      .eq("state", "uploaded");
    throw new Error(message);
  }

  if (extracted.status !== "SUCCESS") {
    const detail =
      extracted.errors.map((error) => error.message).join("; ") ||
      extracted.warnings.map((warning) => warning.message).join("; ") ||
      "Extraction incomplète : aucune sortie exploitable";
    const diagnostics = await extractionDiagnostics(extracted);
    const message = `Extraction refusée avant matérialisation: ${detail} ${diagnostics}`;

    await supabase
      .from("import_documents")
      .update({
        state: "failed",
        page_count: extracted.pages.length,
        error_message: message,
      })
      .eq("id", document.id)
      .eq("state", "uploaded");

    throw new Error(message);
  }

  const { prepareImportItemsForMaterialization } = await import(
    "../import/materialization"
  );
  const candidates = prepareImportItemsForMaterialization(
    extracted.candidates,
    session.id,
    document.id
  );

  const { data, error } = await supabase.rpc(
    "materialize_import_document",
    {
      p_document_id: document.id,
      p_candidates: candidates,
      p_page_count: extracted.pages.length,
    }
  );

  if (error) {
    throw new Error(
      `Erreur matérialisation transactionnelle: ${error.message}`
    );
  }

  return (data ?? []) as DatabaseImportItem[];
}


// ---------------------------------------------------------------------------
// Phase 5B — Matching + revue utilisateur
// ---------------------------------------------------------------------------

function fieldFromItem(
  item: DatabaseImportItem,
  field: "name" | "phone" | "email"
): { raw: string; normalized?: string | number | null } | undefined {
  const value = item.fields[field];
  return value ? { raw: value.raw, normalized: value.normalized } : undefined;
}

async function fetchMatchingEntities(
  supabase: ServerSupabase,
  organizationId: string
): Promise<Record<"category" | "product" | "customer" | "supplier", ExistingImportEntity[]>> {
  const [categories, products, customers, suppliers] = await Promise.all([
    supabase.from("categories").select("id, name").eq("organization_id", organizationId).order("name"),
    supabase.from("products").select("id, name").eq("organization_id", organizationId).order("name"),
    supabase.from("customers").select("id, name, phone, email").eq("organization_id", organizationId).order("name"),
    supabase.from("suppliers").select("id, name, phone, email").eq("organization_id", organizationId).order("name"),
  ]);

  const errors = [categories.error, products.error, customers.error, suppliers.error].filter(Boolean);
  if (errors.length > 0) {
    throw new Error(
      `Erreur lecture des entités existantes pour le matching: ${errors.map((error) => error?.message).join("; ")}`
    );
  }

  return {
    category: (categories.data ?? []) as ExistingImportEntity[],
    product: (products.data ?? []) as ExistingImportEntity[],
    customer: (customers.data ?? []) as ExistingImportEntity[],
    supplier: (suppliers.data ?? []) as ExistingImportEntity[],
  };
}

export async function matchImportSession(
  sessionId: string
): Promise<DatabaseImportItem[]> {
  uuidSchema.parse(sessionId);

  const supabase = await createServerSupabase();
  await requireAuth(supabase);

  const session = await fetchSession(supabase, sessionId);
  await requireManagerRole(supabase, session.organization_id);

  if (session.state !== "processing" && session.state !== "needs_review") {
    throw new Error(
      `Matching autorisé pendant le traitement/review uniquement (état: ${session.state})`
    );
  }

  const { data: rows, error: itemsError } = await supabase
    .from("import_items")
    .select("*")
    .eq("session_id", session.id)
    .in("status", ["pending"])
    .order("created_at", { ascending: true });

  if (itemsError) {
    throw new Error(`Erreur lecture items à rapprocher: ${itemsError.message}`);
  }

  const items = (rows ?? []) as DatabaseImportItem[];
  if (items.length === 0) {
    const { data: existing, error } = await supabase
      .from("import_items")
      .select("*")
      .eq("session_id", session.id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`Erreur lecture items: ${error.message}`);
    return (existing ?? []) as DatabaseImportItem[];
  }

  const entities = await fetchMatchingEntities(
    supabase,
    session.organization_id
  );

  const proposals = items.map((item) => ({
    item_id: item.id,
    ...proposeImportItemMatch(
      {
        entityType: item.entity_type,
        fields: {
          name: fieldFromItem(item, "name") ?? { raw: "" },
          ...(fieldFromItem(item, "phone")
            ? { phone: fieldFromItem(item, "phone") }
            : {}),
          ...(fieldFromItem(item, "email")
            ? { email: fieldFromItem(item, "email") }
            : {}),
        },
      },
      entities[item.entity_type]
    ),
  }));

  const { data, error } = await supabase.rpc("apply_import_matches", {
    p_session_id: session.id,
    p_matches: proposals,
  });

  if (error) {
    throw new Error(`Erreur application des propositions de matching: ${error.message}`);
  }

  return (data ?? []) as DatabaseImportItem[];
}

export async function decideImportItem(input: {
  id: string;
  action: "create" | "use_existing" | "update" | "ignore";
  existingId?: string | null;
}): Promise<DatabaseImportItem> {
  uuidSchema.parse(input.id);
  if (input.existingId) uuidSchema.parse(input.existingId);

  if (
    (input.action === "use_existing" || input.action === "update") &&
    !input.existingId
  ) {
    throw new Error("Une entité existante est requise pour cette décision");
  }
  if (
    (input.action === "create" || input.action === "ignore") &&
    input.existingId
  ) {
    throw new Error("Cette décision ne doit pas cibler une entité existante");
  }

  const supabase = await createServerSupabase();
  await requireAuth(supabase);

  const { data, error } = await supabase.rpc("set_import_item_decision", {
    p_item_id: input.id,
    p_action: input.action,
    p_existing_id: input.existingId ?? null,
  });

  if (error) {
    throw new Error(`Erreur enregistrement de la décision: ${error.message}`);
  }

  return data as DatabaseImportItem;
}

function normalizeReviewedValue(field: string, raw: string): string | number | null {
  const value = raw.trim();
  if (!value) return null;

  if (field === "cost_price" || field === "sale_price") {
    const cleaned = value
      .replace(/[\u00a0\s]/g, "")
      .replace(/[^0-9,.-]/g, "");

    const comma = cleaned.lastIndexOf(",");
    const dot = cleaned.lastIndexOf(".");

    let normalized = cleaned;
    if (comma !== -1 && dot !== -1) {
      const decimalSeparator = comma > dot ? "," : ".";
      const thousandsSeparator = decimalSeparator === "," ? "." : ",";
      normalized = cleaned
        .split(thousandsSeparator).join("")
        .replace(decimalSeparator, ".");
    } else if (comma !== -1) {
      const decimals = cleaned.length - comma - 1;
      normalized = decimals === 3
        ? cleaned.replace(",", "")
        : cleaned.replace(",", ".");
    } else if ((dot !== -1 && cleaned.length - dot - 1 === 3)) {
      normalized = cleaned.replace(".", "");
    }

    const numeric = Number(normalized);
    if (!Number.isFinite(numeric) || numeric < 0) {
      throw new Error(`Valeur numérique invalide pour ${field}`);
    }
    return numeric;
  }

  if (field === "min_stock_threshold" || field === "stock_quantity") {
    const normalized = value.replace(/[^0-9-]/g, "");
    const numeric = Number(normalized);
    if (!Number.isInteger(numeric) || numeric < 0) {
      throw new Error(`Valeur entière invalide pour ${field}`);
    }
    return numeric;
  }

  return value;
}

export async function updateImportItemFields(input: {
  id: string;
  values: Record<string, string>;
}): Promise<DatabaseImportItem> {
  uuidSchema.parse(input.id);

  const supabase = await createServerSupabase();
  await requireAuth(supabase);

  const { data: itemData, error: itemError } = await supabase
    .from("import_items")
    .select("*")
    .eq("id", input.id)
    .limit(1)
    .maybeSingle();

  if (itemError) {
    throw new Error(`Erreur lecture item d'import: ${itemError.message}`);
  }
  if (!itemData) throw new Error("Item d'import introuvable");

  const item = itemData as DatabaseImportItem;
  const session = await fetchSession(supabase, item.session_id);
  await requireManagerRole(supabase, session.organization_id);

  if (session.state !== "needs_review") {
    throw new Error(
      `Modification autorisée uniquement pendant la revue (session: ${session.state})`
    );
  }

  if (item.status === "imported") {
    throw new Error("Un item déjà importé ne peut plus être modifié");
  }

  if (!input.values || typeof input.values !== "object") {
    throw new Error("Valeurs de modification invalides");
  }

  const allowedFields = IMPORT_TARGET_FIELDS[item.entity_type] as readonly string[];
  const unknownField = Object.keys(input.values).find(
    (field) => !allowedFields.includes(field)
  );
  if (unknownField) {
    throw new Error(`Champ non modifiable pour cet item: ${unknownField}`);
  }

  const nextFields: Record<string, ImportFieldProvenance> = {};

  for (const field of allowedFields) {
    const provenance = item.fields[field];
    const hasValue = Object.prototype.hasOwnProperty.call(input.values, field);
    const raw = hasValue
      ? String(input.values[field] ?? "").trim()
      : provenance?.raw?.trim() ?? "";

    if (field === "name" && raw.length === 0) {
      throw new Error("Le nom est obligatoire");
    }

    if (raw.length === 0) continue;

    const changed = !provenance || raw !== provenance.raw.trim();
    nextFields[field] = {
      raw,
      normalized: changed
        ? normalizeReviewedValue(field, raw)
        : provenance?.normalized !== undefined
          ? provenance.normalized
          : normalizeReviewedValue(field, raw),
      confidence: "high",
      ...(provenance?.page !== undefined ? { page: provenance.page } : {}),
      warning: changed
        ? "Modifié manuellement par l'utilisateur."
        : provenance?.warning ?? undefined,
    };
  }

  const parsed = importFieldsSchema(item.entity_type).safeParse(nextFields);
  if (!parsed.success) {
    throw new Error(
      `Données modifiées invalides: ${parsed.error.issues
        .map((issue) => issue.message)
        .join("; ")}`
    );
  }

  const { data, error } = await supabase
    .from("import_items")
    .update({
      fields: parsed.data,
      match: null,
      action: "create",
      status: "pending",
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id)
    .eq("session_id", session.id)
    .eq("organization_id", session.organization_id)
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `Erreur enregistrement de la modification: ${error?.message ?? "aucune ligne mise à jour"}`
    );
  }

  return data as DatabaseImportItem;
}

export async function deleteImportItem(itemId: string): Promise<void> {
  uuidSchema.parse(itemId);

  const supabase = await createServerSupabase();
  await requireAuth(supabase);

  const { data: item, error: itemError } = await supabase
    .from("import_items")
    .select("*")
    .eq("id", itemId)
    .limit(1)
    .maybeSingle();

  if (itemError) {
    throw new Error(`Erreur lecture item d'import: ${itemError.message}`);
  }
  if (!item) throw new Error("Item d'import introuvable");

  const typedItem = item as DatabaseImportItem;
  const session = await fetchSession(supabase, typedItem.session_id);
  await requireManagerRole(supabase, session.organization_id);

  if (session.state !== "needs_review") {
    throw new Error(
      `Suppression d'un élément autorisée uniquement pendant la revue (session: ${session.state})`
    );
  }

  if (typedItem.status === "imported") {
    throw new Error("Un item déjà importé ne peut plus être supprimé");
  }

  const { error } = await supabase
    .from("import_items")
    .delete()
    .eq("id", typedItem.id)
    .eq("session_id", session.id)
    .eq("organization_id", session.organization_id);

  if (error) {
    throw new Error(`Erreur suppression item d'import: ${error.message}`);
  }
}

export async function finalizeImportReview(
  sessionId: string
): Promise<DatabaseImportSession> {
  uuidSchema.parse(sessionId);

  const supabase = await createServerSupabase();
  await requireAuth(supabase);

  const session = await fetchSession(supabase, sessionId);
  await requireManagerRole(supabase, session.organization_id);

  const { data, error } = await supabase.rpc("finalize_import_review", {
    p_session_id: sessionId,
  });

  if (error) {
    throw new Error(`Erreur finalisation de la revue: ${error.message}`);
  }

  return data as DatabaseImportSession;
}

export async function commitImportSession(
  sessionId: string
): Promise<DatabaseImportSession> {
  uuidSchema.parse(sessionId);

  const supabase = await createServerSupabase();
  await requireAuth(supabase);

  const session = await fetchSession(supabase, sessionId);
  await requireManagerRole(supabase, session.organization_id);

  const { data, error } = await supabase.rpc("import_commit", {
    p_session_id: sessionId,
  });

  if (error) {
    throw new Error(`Erreur commit de l'import: ${error.message}`);
  }

  return data as DatabaseImportSession;
}
