import { z } from "zod";
import { importFieldsSchema } from "../schemas";
import type { ExtractedCandidate } from "./types";

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
