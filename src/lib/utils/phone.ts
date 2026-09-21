/**
 * Normalisation des numéros de téléphone pour la détection de doublons.
 *
 * On NE cherche PAS l'unicité globale (contrainte DB interdite) : on fournit
 * seulement un avertissement à l'utilisateur, qui garde la décision finale
 * (le même numéro peut être légitime pour deux contacts distincts).
 */

/** Retire espaces, tirets, points et parenthèses pour comparer les numéros. */
export function normalizePhone(phone: string): string {
  return (phone ?? "").replace(/[\s\-().]/g, "").trim();
}

export interface PhoneOwner {
  id: string;
  name: string;
  phone: string;
}

/**
 * Retourne les entités dont le numéro normalisé est identique à `phone`.
 * - ignore `excludeId` (édition d'une entité existante)
 * - retourne [] si le numéro est trop court pour être significatif
 */
export function findPhoneMatches<T extends PhoneOwner>(
  all: T[],
  phone: string,
  excludeId?: string
): T[] {
  const normalized = normalizePhone(phone);
  if (normalized.length < 3) return [];
  return all.filter(
    (c) => c.id !== excludeId && normalizePhone(c.phone ?? "") === normalized
  );
}
