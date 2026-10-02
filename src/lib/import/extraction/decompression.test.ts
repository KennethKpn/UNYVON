import { deflateRawSync, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  createDecompressionBudget,
  MAX_DECOMPRESSED_BYTES,
} from "./decompression";

// ---------------------------------------------------------------------------
// Budget de décompression documentaire — mécanisme (budgets réduits pour une
// suite rapide ; la limite réelle MAX_DECOMPRESSED_BYTES est exercée côté
// adaptateurs dans extractor.test.ts).
// ---------------------------------------------------------------------------

describe("budget de décompression", () => {
  it("borne par défaut à MAX_DECOMPRESSED_BYTES (32 MiB)", () => {
    expect(MAX_DECOMPRESSED_BYTES).toBe(32 * 1024 * 1024);
    expect(createDecompressionBudget().remaining).toBe(MAX_DECOMPRESSED_BYTES);
  });

  it("décrémente le budget par les octets réellement produits", () => {
    const budget = createDecompressionBudget(8192);
    const out = budget.inflate(deflateSync(Buffer.alloc(4096, 0x41)));
    expect(out.ok).toBe(true);
    expect(out.data?.length).toBe(4096);
    expect(budget.remaining).toBe(4096);
  });

  it("autorise une sortie exactement égale au budget restant", () => {
    const budget = createDecompressionBudget(4096);
    const out = budget.inflate(deflateSync(Buffer.alloc(4096, 0x41)));
    expect(out.ok).toBe(true);
    expect(out.data?.length).toBe(4096);
    expect(budget.remaining).toBe(0);
  });

  it("bloque une décompression dont la sortie dépasse le budget restant", () => {
    const budget = createDecompressionBudget(1024);
    const out = budget.inflate(deflateSync(Buffer.alloc(4096, 0x41)));
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("DECOMPRESSION_BUDGET_EXCEEDED");
    expect(out.data).toBeUndefined();
  });

  it("le budget est partagé : la somme des sorties ne peut pas dépasser la limite", () => {
    const budget = createDecompressionBudget(8192);
    const chunk = deflateSync(Buffer.alloc(4096, 0x41));
    expect(budget.inflate(chunk).ok).toBe(true);
    expect(budget.inflate(chunk).ok).toBe(true);
    const third = budget.inflate(chunk);
    expect(third.ok).toBe(false);
    expect(third.reason).toBe("DECOMPRESSION_BUDGET_EXCEEDED");
  });

  it("ne produit aucune sortie exploitable en cas de dépassement", () => {
    const budget = createDecompressionBudget(1024);
    const out = budget.inflate(deflateSync(Buffer.alloc(1_000_000, 0x42)));
    expect(out.ok).toBe(false);
    expect(out.data).toBeUndefined();
  });

  it("gère le format raw (deflate) utilisé par les DOCX", () => {
    const budget = createDecompressionBudget(8192);
    const out = budget.inflate(deflateRawSync(Buffer.alloc(4096, 0x43)), {
      raw: true,
    });
    expect(out.ok).toBe(true);
    expect(out.data?.length).toBe(4096);
  });

  it("distingue une corruption (Z_DATA_ERROR) d'un dépassement de budget", () => {
    const budget = createDecompressionBudget(8192);
    const corrupt = budget.inflate(Buffer.from([0x00, 0x01, 0x02, 0x03]));
    expect(corrupt.ok).toBe(false);
    expect(corrupt.reason).toBe("DECOMPRESSION_ERROR");
  });
});
