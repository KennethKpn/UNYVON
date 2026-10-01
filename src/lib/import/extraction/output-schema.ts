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

// Comparaison insensible à la casse et aux espaces (une valeur « 2 500 » et un
// document « 2500 » ne doivent pas produire de faux négatif).
function normalizeForCitation(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function isCitable(haystack: string, raw: string): boolean {
  if (raw.trim().length === 0) return true; // rien à vérifier
  return normalizeForCitation(haystack).includes(normalizeForCitation(raw));
}

export function verifyProvenanceAgainstPages(
  candidates: ExtractedCandidate[],
  pages: ExtractedPage[]
): ExtractedCandidate[] {
  // Sans texte de référence (voie image, document sans page) : aucune
  // vérification possible, la sortie validée est conservée telle quelle.
  if (pages.length === 0) return candidates;

  const byPage = new Map<number, string>(pages.map((page) => [page.page, page.text]));
  const wholeDocument = pages.map((page) => page.text).join("\n");

  return candidates.map((candidate) => {
    // Page citée si elle existe et figure réellement dans le document, sinon
    // le document entier : une valeur absente partout reste absente partout.
    const cited = candidate.page !== null ? byPage.get(candidate.page) : undefined;
    const haystack = cited ?? wholeDocument;

    let degraded = false;
    const fields: ExtractedCandidate["fields"] = {};
    for (const [field, provenance] of Object.entries(candidate.fields)) {
      if (!provenance || isCitable(haystack, provenance.raw)) {
        fields[field] = provenance;
        continue;
      }
      degraded = true;
      fields[field] = {
        ...provenance,
        confidence: "low",
        warning: PROVENANCE_UNVERIFIED_WARNING,
      };
    }
    return degraded ? { ...candidate, fields } : candidate;
  });
}
