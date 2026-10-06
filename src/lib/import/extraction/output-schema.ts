import { z } from "zod";
import { importFieldsSchema } from "../schemas";
import type { ExtractedCandidate, ExtractedPage } from "./types";

// ---------------------------------------------------------------------------
// Validation stricte de la sortie LLM — jamais de confiance aveugle.
// Réutilise importFieldsSchema (Phase 2) : champs strictement limités à
// IMPORT_TARGET_FIELDS[entityType], name obligatoire, provenance requise.
// ---------------------------------------------------------------------------

const candidateSchema = z.discriminatedUnion("entityType", [
  z.strictObject({
    entityType: z.literal("category"),
    fields: importFieldsSchema("category"),
    page: z.number().int().min(1).nullable().optional(),
  }),
  z.strictObject({
    entityType: z.literal("product"),
    fields: importFieldsSchema("product"),
    page: z.number().int().min(1).nullable().optional(),
  }),
  z.strictObject({
    entityType: z.literal("customer"),
    fields: importFieldsSchema("customer"),
    page: z.number().int().min(1).nullable().optional(),
  }),
  z.strictObject({
    entityType: z.literal("supplier"),
    fields: importFieldsSchema("supplier"),
    page: z.number().int().min(1).nullable().optional(),
  }),
]);

export const llmExtractionOutputSchema = z.strictObject({
  candidates: z.array(candidateSchema),
});

export type LlmExtractionOutput = z.infer<typeof llmExtractionOutputSchema>;

function derivePage(
  fields: ExtractedCandidate["fields"],
  explicitPage: number | null | undefined
): number | null {
  if (explicitPage !== undefined && explicitPage !== null) return explicitPage;
  for (const provenance of Object.values(fields)) {
    if (provenance && provenance.page !== null && provenance.page !== undefined) {
      return provenance.page;
    }
  }
  return null;
}

export type ValidateLlmResult =
  | { ok: true; candidates: ExtractedCandidate[] }
  | { ok: false; issues: string[] };

export function validateLlmOutput(
  output: unknown,
  documentId = ""
): ValidateLlmResult {
  const parsed = llmExtractionOutputSchema.safeParse(output);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "(racine)"}: ${issue.message}`
      ),
    };
  }
  const candidates = parsed.data.candidates.map((candidate) => ({
    entityType: candidate.entityType,
    fields: candidate.fields,
    documentId,
    page: derivePage(candidate.fields, candidate.page),
  }));
  return { ok: true, candidates };
}

// ---------------------------------------------------------------------------
// Provenance : une valeur doit être retrouvable dans le texte qu'elle cite.
//
// `confidence: "high"` n'est qu'une affirmation du modèle : elle ne vaut pas
// preuve. Si la valeur littérale annoncée n'apparaît dans AUCUNE page, elle ne
// peut pas être considérée comme une citation fiable — que le modèle l'ait
// inventée ou qu'il ait obéi à une consigne glissée dans le document.
//
// Correction volontairement MINIMALE et déterministe (aucune architecture de
// provenance nouvelle) : la confiance n'est jamais relevée, seulement abaissée à
// "low", et un `warning` est posé sur le champ concerné. Le schéma Phase 2
// reste inchangé. La vérification est textuelle et littérale — elle ne suppose
// rien du comportement du modèle.
// ---------------------------------------------------------------------------
export const PROVENANCE_UNVERIFIED_WARNING =
  "Valeur non retrouvée dans le texte de la page citée : citation non fiable.";

export const PROVENANCE_INVALID_PAGE_WARNING =
  "Page de provenance invalide ou absente du document : citation non vérifiable.";

export const VISION_PROVENANCE_UNVERIFIED_WARNING =
  "Provenance issue d'une analyse visuelle non corroborée par un texte local : vérification humaine requise.";

export const PAGINATION_UNVERIFIED_WARNING =
  "La valeur est retrouvée dans le document, mais sa page ne peut pas être vérifiée de façon fiable : vérification humaine requise.";

export const DOC_BEST_EFFORT_WARNING =
  "Extraction DOC legacy best-effort : certaines données peuvent être absentes ou mal ordonnées, vérification humaine requise.";

// Comparaison insensible à la casse et aux espaces (une valeur « 2 500 » et un
// document « 2500 » ne doivent pas produire de faux négatif).
function normalizeForCitation(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function isCitable(haystack: string, raw: string): boolean {
  if (raw.trim().length === 0) return true; // rien à vérifier
  return normalizeForCitation(haystack).includes(normalizeForCitation(raw));
}

export interface ProvenanceVerificationOptions {
  pageNumbersTrusted?: boolean;
  pageWarning?: string;
}

export function verifyProvenanceAgainstPages(
  candidates: ExtractedCandidate[],
  pages: ExtractedPage[],
  options: ProvenanceVerificationOptions = {}
): ExtractedCandidate[] {
  // Sans texte de référence (voie image, document sans page) : aucune
  // vérification textuelle possible.
  if (pages.length === 0) return candidates;

  const pageNumbersTrusted = options.pageNumbersTrusted ?? true;
  const pageWarning = options.pageWarning ?? PAGINATION_UNVERIFIED_WARNING;
  const byPage = new Map<number, string>(pages.map((page) => [page.page, page.text]));
  const wholeDocument = pages.map((page) => page.text).join("\n");

  return candidates.map((candidate) => {
    let changed = false;
    const fields: ExtractedCandidate["fields"] = {};

    for (const [field, provenance] of Object.entries(candidate.fields)) {
      if (!provenance) {
        fields[field] = provenance;
        continue;
      }

      // Si la pagination n'est pas fiable (DOCX aplati, PDF page tree non
      // vérifié), la seule preuve sûre reste la présence littérale dans tout le
      // texte extrait. Toute page annoncée est supprimée pour ne pas créer une
      // fausse citation.
      if (!pageNumbersTrusted) {
        const cited = isCitable(wholeDocument, provenance.raw);
        changed = true;
        fields[field] = {
          ...provenance,
          confidence: "low",
          page: null,
          warning: cited
            ? pageWarning
            : `${pageWarning} ${PROVENANCE_UNVERIFIED_WARNING}`,
        };
        continue;
      }

      const effectivePage = provenance.page ?? candidate.page;
      const hasExplicitPage = effectivePage !== null && effectivePage !== undefined;
      const cited = hasExplicitPage ? byPage.get(effectivePage) : undefined;

      if (hasExplicitPage && cited === undefined) {
        changed = true;
        fields[field] = {
          ...provenance,
          confidence: "low",
          warning: PROVENANCE_INVALID_PAGE_WARNING,
        };
        continue;
      }

      const haystack = cited ?? wholeDocument;
      if (isCitable(haystack, provenance.raw)) {
        fields[field] = provenance;
        continue;
      }

      changed = true;
      fields[field] = {
        ...provenance,
        confidence: "low",
        warning: PROVENANCE_UNVERIFIED_WARNING,
      };
    }

    if (!pageNumbersTrusted) {
      return { ...candidate, page: null, fields };
    }
    return changed ? { ...candidate, fields } : candidate;
  });
}

export function markDocumentWarningUnverified(
  candidates: ExtractedCandidate[],
  warning: string
): ExtractedCandidate[] {
  return candidates.map((candidate) => ({
    ...candidate,
    page: null,
    fields: Object.fromEntries(
      Object.entries(candidate.fields).map(([field, provenance]) => [
        field,
        provenance
          ? {
              ...provenance,
              confidence: "low" as const,
              page: null,
              warning: provenance.warning
                ? `${provenance.warning} ${warning}`
                : warning,
            }
          : provenance,
      ])
    ),
  }));
}

export function markVisionProvenanceUnverified(
  candidates: ExtractedCandidate[]
): ExtractedCandidate[] {
  return candidates.map((candidate) => ({
    ...candidate,
    page: null,
    fields: Object.fromEntries(
      Object.entries(candidate.fields).map(([field, provenance]) => [
        field,
        provenance
          ? {
              ...provenance,
              confidence: "low" as const,
              page: null,
              warning: VISION_PROVENANCE_UNVERIFIED_WARNING,
            }
          : provenance,
      ])
    ),
  }));
}
