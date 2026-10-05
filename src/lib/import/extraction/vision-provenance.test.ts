import { describe, expect, it } from "vitest";
import {
  VISION_PROVENANCE_UNVERIFIED_WARNING,
  markVisionProvenanceUnverified,
} from "./output-schema";
import { structureParsedDocument } from "./extractor";
import type { Provider } from "./provider";
import type { ExtractedCandidate } from "./types";

const CANDIDATE: ExtractedCandidate = {
  entityType: "product",
  documentId: "00000000-0000-4000-8000-000000000001",
  page: 4,
  fields: {
    name: { raw: "Savon", confidence: "high", page: 4 },
    sale_price: { raw: "1500", confidence: "medium", page: 4 },
  },
};

const OUTPUT = {
  candidates: [
    {
      entityType: "product",
      fields: {
        name: { raw: "Savon", confidence: "high", page: 4 },
        sale_price: { raw: "1500", confidence: "medium", page: 4 },
      },
    },
  ],
};

const provider: Provider = {
  name: "vision-test",
  async parse() {
    return OUTPUT;
  },
};

describe("provenance visuelle non vérifiable", () => {
  it("dégrade toute provenance image non corroborable et invalide la page comme autorité", () => {
    const [candidate] = markVisionProvenanceUnverified([CANDIDATE]);

    expect(candidate.page).toBeNull();
    expect(candidate.fields.name?.confidence).toBe("low");
    expect(candidate.fields.name?.page).toBeNull();
    expect(candidate.fields.name?.warning).toBe(
      VISION_PROVENANCE_UNVERIFIED_WARNING
    );
    expect(candidate.fields.sale_price?.confidence).toBe("low");
  });

  it.each(["image-llm", "pdf-llm"] as const)(
    "%s produit SUCCESS mais impose une vérification humaine de provenance",
    async (source) => {
      const doc = await structureParsedDocument(
        {
          documentId: CANDIDATE.documentId,
          sourceKind: source === "image-llm" ? "image" : "pdf",
          filename: source === "image-llm" ? "photo.png" : "scan.pdf",
          bytes: new Uint8Array([1, 2, 3]),
        },
        {
          version: 1,
          source,
          pages: [],
          warnings: [],
        },
        provider
      );

      expect(doc.status).toBe("SUCCESS");
      expect(doc.candidates).toHaveLength(1);
      expect(doc.candidates[0]?.page).toBeNull();
      expect(doc.candidates[0]?.fields.name?.confidence).toBe("low");
      expect(doc.candidates[0]?.fields.name?.page).toBeNull();
      expect(doc.candidates[0]?.fields.name?.warning).toBe(
        VISION_PROVENANCE_UNVERIFIED_WARNING
      );
      expect(doc.warnings.some((w) => w.code === "VISION_PROVENANCE_UNVERIFIED")).toBe(
        true
      );
    }
  );
});
