import { inflateRawSync, inflateSync } from "node:zlib";

// ---------------------------------------------------------------------------
// Budget de décompression documentaire (anti zip / decompression bomb)
//
// IMPORT_MAX_FILE_BYTES (25 Mo) borne le fichier ENTRANT. Une entrée compressée
// peut produire une sortie bien plus grande : une simple limite par flux ne
// suffit pas, car un PDF contient plusieurs flux FlateDecode. Ce module fournit
// un budget documentaire UNIQUE — créé une fois par document et partagé par
// toutes ses décompressions — qui n'est jamais contournable en cumulant les flux.
//
// Chaque décompression reçoit au maximum le budget restant via maxOutputLength
// (Node zlib) : en cas de dépassement, aucune sortie n'est produite et le budget
// signale DECOMPRESSION_BUDGET_EXCEEDED. Après chaque décompression réussie, le
// budget est décrémenté du nombre d'octets réellement produits.
// ---------------------------------------------------------------------------

export const MAX_DECOMPRESSED_BYTES = 32 * 1024 * 1024;

export type DecompressionFailureReason =
  | "DECOMPRESSION_BUDGET_EXCEEDED"
  | "DECOMPRESSION_ERROR";

export interface DecompressionOutcome {
  ok: boolean;
  data?: Buffer;
  reason?: DecompressionFailureReason;
}

export interface DecompressionBudget {
  readonly remaining: number;
  inflate(data: Uint8Array, options?: { raw?: boolean }): DecompressionOutcome;
}

// Node zlib lève ERR_BUFFER_TOO_LARGE (RangeError) quand maxOutputLength est
// dépassé ; une corruption lève Z_DATA_ERROR. Les deux sont distingués pour ne
// pas confondre une donnée illisible avec un dépassement de budget.
function isBudgetExceeded(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ((error as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE") return true;
  return (
    error instanceof RangeError &&
    /larger than|maxOutputLength/i.test((error as Error).message)
  );
}

export function createDecompressionBudget(
  maxBytes: number = MAX_DECOMPRESSED_BYTES
): DecompressionBudget {
  let remaining = maxBytes;
  return {
    get remaining() {
      return remaining;
    },
    inflate(data, options) {
      if (remaining <= 0) {
        return { ok: false, reason: "DECOMPRESSION_BUDGET_EXCEEDED" };
      }
      try {
        const out = options?.raw
          ? inflateRawSync(data, { maxOutputLength: remaining })
          : inflateSync(data, { maxOutputLength: remaining });
        remaining -= out.length;
        return { ok: true, data: out };
      } catch (error) {
        if (isBudgetExceeded(error)) {
          return { ok: false, reason: "DECOMPRESSION_BUDGET_EXCEEDED" };
        }
        return { ok: false, reason: "DECOMPRESSION_ERROR" };
      }
    },
  };
}
