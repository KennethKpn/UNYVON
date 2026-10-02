"use client";

import { createClient } from "@/lib/supabase/client";
import { importStoragePathSchema } from "./schemas";
import { IMPORT_MAX_FILE_BYTES } from "./types";

// Écriture/lecture Storage côté navigateur (server actions : limite de corps
// 1 Mo face aux 25 Mo du bucket). La ligne import_documents est créée par la
// server action AVANT cet appel : aucun objet ne peut devenir orphelin sans
// une row correspondante, et tout chemin non conforme est refusé avant le
// moindre appel réseau.

function requireValidStoragePath(storagePath: string): void {
  if (!importStoragePathSchema.safeParse(storagePath).success) {
    throw new Error("Chemin de stockage invalide");
  }
}

export async function uploadImportDocument(
  file: File,
  storagePath: string
): Promise<void> {
  requireValidStoragePath(storagePath);
  if (file.size > IMPORT_MAX_FILE_BYTES) {
    throw new Error("Fichier trop volumineux (25 Mo maximum)");
  }

  const supabase = createClient();
  const { error } = await supabase.storage.from("imports").upload(storagePath, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) {
    throw new Error(`Erreur upload document: ${error.message}`);
  }
}

export async function deleteImportStorageObject(storagePath: string): Promise<void> {
  requireValidStoragePath(storagePath);

  const supabase = createClient();
  const { error } = await supabase.storage.from("imports").remove([storagePath]);
  if (error) {
    throw new Error(`Erreur suppression document: ${error.message}`);
  }
}
