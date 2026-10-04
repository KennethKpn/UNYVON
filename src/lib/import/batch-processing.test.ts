import { describe, expect, it, vi } from "vitest";
import { processImportDocumentBatch } from "./batch-processing";

describe("processImportDocumentBatch", () => {
  it("continue avec les documents suivants quand un document échoue", async () => {
    const calls: string[] = [];
    const materialize = vi.fn(async (id: string) => {
      calls.push(id);
      if (id === "doc-2") throw new Error("Gemini 503");
    });

    const result = await processImportDocumentBatch(
      [
        { id: "doc-1", original_name: "page1.jpg" },
        { id: "doc-2", original_name: "page2.jpg" },
        { id: "doc-3", original_name: "page3.jpg" },
      ],
      materialize
    );

    expect(calls).toEqual(["doc-1", "doc-2", "doc-3"]);
    expect(result.succeeded).toEqual(["doc-1", "doc-3"]);
    expect(result.failed).toEqual([{ id: "doc-2", name: "page2.jpg" }]);
  });

  it("signale tous les échecs sans masquer les documents réussis", async () => {
    const result = await processImportDocumentBatch(
      [
        { id: "doc-1", original_name: "page1.jpg" },
        { id: "doc-2", original_name: "page2.jpg" },
      ],
      async () => {
        throw new Error("HTTP 429");
      }
    );

    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual([
      { id: "doc-1", name: "page1.jpg" },
      { id: "doc-2", name: "page2.jpg" },
    ]);
  });
});
