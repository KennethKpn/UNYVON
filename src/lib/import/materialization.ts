import { importItemInputSchema } from "./schemas";
import { exactImportDedupFingerprint } from "./matching";
import type { ExtractedCandidate } from "./extraction/types";
import type { ImportEntityType, ImportFieldProvenance } from "./types";

const MAX_IMPORT_ITEMS_PER_DOCUMENT = 500;

export interface MaterializedImportCandidate {
  entity_type: ImportEntityType;
  source_page: number | null;
  fields: Record<string, ImportFieldProvenance>;
}

// Phase 5A : transforme une sortie d'extraction déjà validée en payload DB.
// Aucun organization_id, UUID métier, action ou statut ne vient du modèle.
// Les valeurs d'autorité pour ces champs sont imposées par la DB/RPC.
export function prepareImportItemsForMaterialization(
  candidates: ExtractedCandidate[],
  sessionId: string,
  documentId: string
): MaterializedImportCandidate[] {
  if (candidates.length > MAX_IMPORT_ITEMS_PER_DOCUMENT) {
    throw new Error(
      `Trop de candidats pour un document (maximum ${MAX_IMPORT_ITEMS_PER_DOCUMENT})`
    );
  }

  const uniqueCandidates = candidates.filter((candidate, index) => {
    const fingerprint = exactImportDedupFingerprint(candidate.entityType, candidate.fields);
    return candidates.findIndex(
      (other) =>
        exactImportDedupFingerprint(other.entityType, other.fields) === fingerprint
    ) === index;
  });

  return uniqueCandidates.map((candidate, index) => {
    if (candidate.documentId !== documentId) {
      throw new Error(
        `Candidat #${index + 1}: documentId incohérent avec le document matérialisé`
      );
    }

    const parsed = importItemInputSchema.safeParse({
      sessionId,
      documentId,
      entityType: candidate.entityType,
      sourcePage: candidate.page,
      fields: candidate.fields,
      match: null,
    });

    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(racine)"}: ${issue.message}`)
        .join("; ");
      throw new Error(
        `Candidat #${index + 1} invalide avant matérialisation: ${detail}`
      );
    }

    return {
      entity_type: parsed.data.entityType,
      source_page: parsed.data.sourcePage ?? null,
      fields: parsed.data.fields,
    };
  });
}
