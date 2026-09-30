"use server";

import { randomUUID } from "node:crypto";
import { createServerSupabase } from "@/lib/supabase/server";
import { resolveMemberOrg, resolveOwnedOrg } from "@/lib/supabase/org-resolve";
import {
  addImportDocumentSchema,
  buildImportStoragePath,
  canTransitionImportDocument,
  canTransitionImportSession,
} from "@/lib/import/schemas";
import type {
  DatabaseImportDocument,
  DatabaseImportSession,
  ImportDocumentState,
} from "@/lib/import/types";
import {
  createDefaultProvider,
  createDocumentExtractor,
  type ExtractedDocument,
} from "@/lib/import/extraction";
import type { z } from "zod";

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

export async function deleteImportDocument(documentId: string): Promise<void> {
  const supabase = await createServerSupabase();
  await requireAuth(supabase);

  const document = await fetchDocument(supabase, documentId);
  await requireManagerRole(supabase, document.organization_id);

  if (!DELETABLE_DOCUMENT_STATES.includes(document.state)) {
    throw new Error("Suppression non autorisée pour cet état du document");
  }

  const { error } = await supabase
    .from("import_documents")
    .delete()
    .eq("id", documentId);
  if (error) {
    throw new Error(`Erreur suppression document: ${error.message}`);
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
// ---------------------------------------------------------------------------

export async function extractImportDocument(
  documentId: string
): Promise<ExtractedDocument> {
  const supabase = await createServerSupabase();
  await requireAuth(supabase);

  const document = await fetchDocument(supabase, documentId);
  await requireManagerRole(supabase, document.organization_id);

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
