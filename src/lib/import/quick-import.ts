"use client";

import {
  addImportDocument,
  cancelImportSession,
  createImportSession,
  deleteImportDocument,
  markImportDocumentUploaded,
} from "@/lib/supabase/import-actions";
import { uploadImportDocument } from "@/lib/import/storage-client";
import { importFileIssue } from "@/lib/import/schemas";
import {
  IMPORT_MAX_FILE_BYTES,
  IMPORT_V1_FORMATS,
  type ImportSourceKind,
  type DatabaseImportSession,
} from "@/lib/import/types";

function mimeForExtension(extension: string): string | null {
  const format = IMPORT_V1_FORMATS.find((item) => item.extension === extension);
  return format?.mimeTypes[0] ?? null;
}

export function getQuickImportSourceKind(file: File): {
  sourceKind: ImportSourceKind;
  mimeType: string;
} | null {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  const format = IMPORT_V1_FORMATS.find((item) => item.extension === extension);
  if (!format) return null;

  const mimeType = file.type.split(";")[0].trim().toLowerCase();
  const normalizedMime = mimeType || mimeForExtension(extension);
  if (!normalizedMime || !format.mimeTypes.includes(normalizedMime)) return null;

  return {
    sourceKind: format.sourceKinds[0],
    mimeType: normalizedMime,
  };
}

export async function createAndUploadImportSession(
  files: File[]
): Promise<DatabaseImportSession> {
  if (files.length === 0) throw new Error("Sélectionnez au moins un fichier.");

  const session = await createImportSession();

  try {
    for (const file of files) {
      if (file.size === 0) throw new Error(`${file.name}: fichier vide`);
      if (file.size > IMPORT_MAX_FILE_BYTES) {
        throw new Error(`${file.name}: 25 Mo maximum`);
      }

      const source = getQuickImportSourceKind(file);
      if (!source) {
        throw new Error(
          `${file.name}: format V1 non supporté ou type MIME incompatible`
        );
      }

      const issue = importFileIssue(
        file.name,
        source.mimeType,
        source.sourceKind
      );
      if (issue) throw new Error(`${file.name}: ${issue}`);

      const created = await addImportDocument({
        sessionId: session.id,
        originalName: file.name,
        sourceKind: source.sourceKind,
        mimeType: source.mimeType,
        sizeBytes: file.size,
      });

      try {
        await uploadImportDocument(file, created.storagePath);
        await markImportDocumentUploaded(created.document.id);
      } catch (error) {
        try {
          await deleteImportDocument(created.document.id);
        } catch {
          // Compensation best-effort; preserve the original upload error.
        }
        throw error;
      }
    }
  } catch (error) {
    try {
      await cancelImportSession(session.id);
    } catch {
      // Keep the session for diagnostic purposes if cancellation fails.
    }
    throw error;
  }

  return session;
}
