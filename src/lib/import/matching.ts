import type { ImportEntityType, ImportItemMatch } from "./types";

export interface ExistingImportEntity {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
}

export interface ImportCandidateForMatching {
  entityType: ImportEntityType;
  fields: Record<string, { raw: string; normalized?: string | number | null }>;
}

function normalizedText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizedPhone(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizedEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function fieldValue(
  candidate: ImportCandidateForMatching,
  field: "name" | "phone" | "email"
): unknown {
  const provenance = candidate.fields[field];
  if (!provenance) return null;
  return provenance.normalized ?? provenance.raw;
}

function candidateHasContact(candidate: ImportCandidateForMatching): boolean {
  return (
    normalizedPhone(fieldValue(candidate, "phone")).length > 0 ||
    normalizedEmail(fieldValue(candidate, "email")).length > 0
  );
}

function contactMatches(
  candidate: ImportCandidateForMatching,
  existing: ExistingImportEntity
): boolean {
  const phone = normalizedPhone(fieldValue(candidate, "phone"));
  const email = normalizedEmail(fieldValue(candidate, "email"));

  return (
    (phone.length > 0 &&
      normalizedPhone(existing.phone) === phone) ||
    (email.length > 0 && normalizedEmail(existing.email) === email)
  );
}

function noMatch(reason: string): ImportItemMatch {
  return {
    existing_id: null,
    existing_name: null,
    score: 0,
    reason,
  };
}

// Matching volontairement conservateur : aucun fuzzy guess.
// 1) nom canonique exact ;
// 2) pour clients/fournisseurs, un contact exact peut disambiguïser ;
// 3) une correspondance ambiguë n'est jamais sélectionnée automatiquement.
export function proposeImportItemMatch(
  candidate: ImportCandidateForMatching,
  existing: ExistingImportEntity[]
): ImportItemMatch {
  const name = normalizedText(fieldValue(candidate, "name"));
  if (!name) {
    return noMatch("Nom absent : aucun rapprochement proposé");
  }

  const nameMatches = existing.filter(
    (entity) => normalizedText(entity.name) === name
  );

  if (nameMatches.length === 1) {
    const exact = nameMatches[0];
    const strengthened =
      (candidate.entityType === "customer" ||
        candidate.entityType === "supplier") &&
      candidateHasContact(candidate) &&
      contactMatches(candidate, exact);

    return {
      existing_id: exact.id,
      existing_name: exact.name,
      score: strengthened ? 1 : 0.9,
      reason: strengthened
        ? "Nom exact + téléphone ou email exact"
        : "Nom exact",
    };
  }

  if (nameMatches.length > 1) {
    const contactMatchesForName = nameMatches.filter((entity) =>
      contactMatches(candidate, entity)
    );
    if (contactMatchesForName.length === 1) {
      const exact = contactMatchesForName[0];
      return {
        existing_id: exact.id,
        existing_name: exact.name,
        score: 1,
        reason: "Nom exact + contact exact, ambiguïté levée",
      };
    }

    return noMatch(
      "Plusieurs entités portent ce nom : sélection manuelle obligatoire"
    );
  }

  if (
    (candidate.entityType === "customer" ||
      candidate.entityType === "supplier") &&
    candidateHasContact(candidate)
  ) {
    const contactMatchesOnly = existing.filter((entity) =>
      contactMatches(candidate, entity)
    );

    if (contactMatchesOnly.length === 1) {
      const exact = contactMatchesOnly[0];
      return {
        existing_id: exact.id,
        existing_name: exact.name,
        score: 0.95,
        reason: "Téléphone ou email exact, nom différent",
      };
    }

    if (contactMatchesOnly.length > 1) {
      return noMatch(
        "Plusieurs entités partagent ce téléphone/email : sélection manuelle obligatoire"
      );
    }
  }

  return noMatch("Aucune correspondance forte trouvée");
}
