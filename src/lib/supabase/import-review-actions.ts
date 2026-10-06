"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { addImportDocumentSchema, buildImportStoragePath, importStoragePathSchema, uuidSchema, canTransitionImportDocument } from "@/lib/import/schemas";
import type {
  DatabaseImportDocument,
  DatabaseImportItem,
  DatabaseImportSession,
  ImportEntityType,
} from "@/lib/import/types";

type ExistingImportOption = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
};

export interface ImportReviewData {
  session: DatabaseImportSession;
  documents: DatabaseImportDocument[];
  items: DatabaseImportItem[];
  options: Record<ImportEntityType, ExistingImportOption[]>;
}

async function requireAuth(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");
}

async function requireManagerRole(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  organizationId: string
): Promise<void> {
  const { data: role, error } = await supabase.rpc("current_org_role", {
    org_id: organizationId,
  });
  if (error) {
    throw new Error(`Erreur vérification du rôle: ${error.message}`);
  }
  if (role !== "owner" && role !== "manager") {
    throw new Error(
      "Seuls les propriétaires et managers peuvent gérer les imports"
    );
  }
}

export async function getImportReviewData(
  sessionId: string
): Promise<ImportReviewData> {
  const parsed = uuidSchema.safeParse(sessionId);
  if (!parsed.success) throw new Error("Identifiant de session invalide");

  const supabase = await createServerSupabase();
  await requireAuth(supabase);

  const { data: session, error: sessionError } = await supabase
    .from("import_sessions")
    .select("*")
    .eq("id", sessionId)
    .limit(1)
    .maybeSingle();

  if (sessionError) {
    throw new Error(`Erreur lecture session d'import: ${sessionError.message}`);
  }
  if (!session) throw new Error("Session d'import introuvable");

  await requireManagerRole(supabase, session.organization_id);

  const [documents, items, categories, products, customers, suppliers] =
    await Promise.all([
      supabase
        .from("import_documents")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true }),
      supabase
        .from("import_items")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true }),
      supabase
        .from("categories")
        .select("id, name")
        .eq("organization_id", session.organization_id)
        .order("name", { ascending: true }),
      supabase
        .from("products")
        .select("id, name")
        .eq("organization_id", session.organization_id)
        .order("name", { ascending: true }),
      supabase
        .from("customers")
        .select("id, name, phone, email")
        .eq("organization_id", session.organization_id)
        .order("name", { ascending: true }),
      supabase
        .from("suppliers")
        .select("id, name, phone, email")
        .eq("organization_id", session.organization_id)
        .order("name", { ascending: true }),
    ]);

  const errors = [
    documents.error,
    items.error,
    categories.error,
    products.error,
    customers.error,
    suppliers.error,
  ].filter(Boolean);

  if (errors.length > 0) {
    throw new Error(
      `Erreur lecture des données de revue: ${errors
        .map((error) => error?.message)
        .join("; ")}`
    );
  }

  return {
    session: session as DatabaseImportSession,
    documents: (documents.data ?? []) as DatabaseImportDocument[],
    items: (items.data ?? []) as DatabaseImportItem[],
    options: {
      category: (categories.data ?? []) as ExistingImportOption[],
      product: (products.data ?? []) as ExistingImportOption[],
      customer: (customers.data ?? []) as ExistingImportOption[],
      supplier: (suppliers.data ?? []) as ExistingImportOption[],
    },
  };
}

/**
 * Reprise déterministe d'un document dont l'extraction a échoué.
 *
 * L'objet Storage reste présent et inchangé. On vérifie donc d'abord son
 * existence exacte, puis on rejoue les transitions autorisées failed → uploading
 * → uploaded. Si la seconde transition échoue, l'état reste uploading et
 * markImportDocumentUploaded peut être rejoué après correction.
 */
/**
 * Prépare un véritable ré-upload lorsqu'un document failed n'a plus son objet
 * Storage. Le navigateur envoie ensuite les octets vers le chemin renvoyé, puis
 * markImportDocumentUploaded ferme à nouveau la fenêtre d'upload.
 *
 * Le serveur reconstruit toujours le chemin à partir des identifiants fiables de
 * la row. Aucun chemin fourni par le navigateur n'est accepté.
 */
export async function prepareImportDocumentReupload(input: {
  documentId: string;
  originalName: string;
  sourceKind: DatabaseImportDocument["source_kind"];
  mimeType: string;
  sizeBytes: number;
}): Promise<{ document: DatabaseImportDocument; storagePath: string }> {
  const parsedDocumentId = uuidSchema.safeParse(input.documentId);
  if (!parsedDocumentId.success) throw new Error("Identifiant document invalide");

  const supabase = await createServerSupabase();
  await requireAuth(supabase);

  const { data: document, error: documentError } = await supabase
    .from("import_documents")
    .select("*")
    .eq("id", input.documentId)
    .limit(1)
    .maybeSingle();

  if (documentError) {
    throw new Error(
      `Erreur lecture document d'import: ${documentError.message}`
    );
  }
  if (!document) throw new Error("Document d'import introuvable");

  await requireManagerRole(supabase, document.organization_id);

  const { data: session, error: sessionError } = await supabase
    .from("import_sessions")
    .select("id, state")
    .eq("id", document.session_id)
    .limit(1)
    .maybeSingle();

  if (sessionError) {
    throw new Error(`Erreur lecture session d'import: ${sessionError.message}`);
  }
  if (!session) throw new Error("Session d'import introuvable");

  if (session.state !== "collecting" && session.state !== "processing") {
    throw new Error(
      `Reprise du document impossible depuis l'état de session ${session.state}`
    );
  }

  if (document.state !== "failed") {
    throw new Error(
      `Réupload autorisé uniquement depuis l'état 'failed' (état actuel : ${document.state})`
    );
  }

  const metadata = addImportDocumentSchema.parse({
    sessionId: document.session_id,
    originalName: input.originalName,
    sourceKind: input.sourceKind,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
  });

  const expectedPrefix = `organizations/${document.organization_id}/imports/${document.session_id}/documents/${document.id}/`;
  if (
    !importStoragePathSchema.safeParse(document.storage_path).success ||
    !document.storage_path.startsWith(expectedPrefix)
  ) {
    throw new Error("Chemin Storage du document invalide");
  }

  const slash = document.storage_path.lastIndexOf("/");
  const folder = document.storage_path.slice(0, slash);
  const fileName = document.storage_path.slice(slash + 1);

  const { data: existingObjects, error: storageError } = await supabase.storage
    .from("imports")
    .list(folder, { search: fileName });

  if (storageError) {
    throw new Error(
      `Erreur vérification objet Storage: ${storageError.message}`
    );
  }

  const oldObjectPresent = (existingObjects ?? []).some(
    (entry) => entry.name === fileName && typeof entry.id === "string"
  );
  if (oldObjectPresent) {
    throw new Error(
      "Objet Storage encore présent : utilisez « Relancer » plutôt que « Réuploader »"
    );
  }

  const storagePath = buildImportStoragePath(
    document.organization_id,
    document.session_id,
    document.id,
    metadata.originalName
  );

  if (!importStoragePathSchema.safeParse(storagePath).success) {
    throw new Error("Chemin Storage de réupload invalide");
  }

  const targetSlash = storagePath.lastIndexOf("/");
  const targetFolder = storagePath.slice(0, targetSlash);
  const targetName = storagePath.slice(targetSlash + 1);
  const { data: targetObjects, error: targetStorageError } = await supabase.storage
    .from("imports")
    .list(targetFolder, { search: targetName });

  if (targetStorageError) {
    throw new Error(
      `Erreur vérification du chemin de réupload: ${targetStorageError.message}`
    );
  }

  const targetPresent = (targetObjects ?? []).some(
    (entry) => entry.name === targetName && typeof entry.id === "string"
  );
  if (targetPresent) {
    throw new Error(
      "Un fichier existe déjà au chemin de réupload : choisissez un autre nom"
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from("import_documents")
    .update({
      original_name: metadata.originalName,
      source_kind: metadata.sourceKind,
      mime_type: metadata.mimeType,
      size_bytes: metadata.sizeBytes,
      storage_path: storagePath,
      state: "uploading",
      page_count: null,
      parsed_artifact: null,
      parsed_at: null,
      processed_at: null,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", document.id)
    .eq("organization_id", document.organization_id)
    .eq("state", "failed")
    .select()
    .single();

  if (updateError || !updated) {
    throw new Error(
      `Erreur préparation du réupload: ${updateError?.message ?? "aucune ligne mise à jour"}`
    );
  }

  return {
    document: updated as DatabaseImportDocument,
    storagePath,
  };
}

export async function retryImportDocument(
  documentId: string
): Promise<DatabaseImportDocument> {
  const parsed = uuidSchema.safeParse(documentId);
  if (!parsed.success) throw new Error("Identifiant document invalide");

  const supabase = await createServerSupabase();
  await requireAuth(supabase);

  const { data: document, error: documentError } = await supabase
    .from("import_documents")
    .select("*")
    .eq("id", documentId)
    .limit(1)
    .maybeSingle();

  if (documentError) {
    throw new Error(
      `Erreur lecture document d'import: ${documentError.message}`
    );
  }
  if (!document) throw new Error("Document d'import introuvable");

  await requireManagerRole(supabase, document.organization_id);

  const { data: session, error: sessionError } = await supabase
    .from("import_sessions")
    .select("id, state")
    .eq("id", document.session_id)
    .limit(1)
    .maybeSingle();

  if (sessionError) {
    throw new Error(`Erreur lecture session d'import: ${sessionError.message}`);
  }
  if (!session) throw new Error("Session d'import introuvable");
  if (session.state !== "collecting" && session.state !== "processing") {
    throw new Error(
      `Reprise du document impossible depuis l'état de session ${session.state}`
    );
  }

  if (!canTransitionImportDocument(document.state, "uploading")) {
    throw new Error(
      `Reprise autorisée uniquement depuis l'état 'failed' (état actuel : ${document.state})`
    );
  }

  const slash = document.storage_path.lastIndexOf("/");
  const folder = document.storage_path.slice(0, slash);
  const fileName = document.storage_path.slice(slash + 1);

  const { data: objects, error: storageError } = await supabase.storage
    .from("imports")
    .list(folder, { search: fileName });

  if (storageError) {
    throw new Error(
      `Erreur vérification objet Storage: ${storageError.message}`
    );
  }

  const present = (objects ?? []).some(
    (entry) => entry.name === fileName && typeof entry.id === "string"
  );
  if (!present) {
    throw new Error(
      "Objet Storage absent : réuploadez le document avant de relancer"
    );
  }

  const { error: firstUpdateError } = await supabase
    .from("import_documents")
    .update({ state: "uploading", error_message: null })
    .eq("id", document.id)
    .eq("state", "failed");

  if (firstUpdateError) {
    throw new Error(
      `Erreur reprise du document d'import: ${firstUpdateError.message}`
    );
  }

  const { data, error } = await supabase
    .from("import_documents")
    .update({ state: "uploaded", error_message: null })
    .eq("id", document.id)
    .eq("state", "uploading")
    .select()
    .single();

  if (error) {
    throw new Error(
      `Document remis en attente d'upload: ${error.message}`
    );
  }

  return data as DatabaseImportDocument;
}
