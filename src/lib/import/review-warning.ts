import type { DatabaseImportItem } from "./types";

const LOW_CONFIDENCE_WARNING = "Confiance faible : vérification humaine recommandée.";

/**
 * Retourne les alertes que la revue doit rendre visibles à l'utilisateur.
 * Les messages sont dédupliqués pour qu'un document très incertain reste lisible.
 */
export function collectImportReviewWarnings(
  item: Pick<DatabaseImportItem, "fields">
): string[] {
  const warnings = new Set<string>();

  for (const field of Object.values(item.fields)) {
    if (field.warning) {
      warnings.add(field.warning);
      continue;
    }
    if (field.confidence === "low") {
      warnings.add(LOW_CONFIDENCE_WARNING);
    }
  }

  return Array.from(warnings);
}
