"use server";

import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { uuidSchema, canTransitionImportDocument } from "@/lib/import/schemas";
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

  if (!canTransitionImportDocument(document.state, "failed")) {
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
