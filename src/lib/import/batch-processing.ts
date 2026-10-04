import type { DatabaseImportDocument } from "./types";

export interface ImportBatchResult {
  succeeded: string[];
  failed: Array<{ id: string; name: string }>;
}

export async function processImportDocumentBatch(
  documents: Pick<DatabaseImportDocument, "id" | "original_name">[],
  materialize: (documentId: string) => Promise<unknown>
): Promise<ImportBatchResult> {
  const result: ImportBatchResult = { succeeded: [], failed: [] };

  for (const document of documents) {
    try {
      await materialize(document.id);
      result.succeeded.push(document.id);
    } catch {
      result.failed.push({ id: document.id, name: document.original_name });
    }
  }

  return result;
}
