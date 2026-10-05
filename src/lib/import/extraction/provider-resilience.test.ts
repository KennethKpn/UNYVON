import { afterEach, describe, expect, it, vi } from "vitest";
import { createProviderFromConfig } from "./provider";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const GEMINI_JSON = JSON.stringify({
  candidates: [
    {
      entityType: "product",
      fields: {
        name: { raw: "Savon", confidence: "high", page: 1 },
      },
    },
  ],
});

function responseOk() {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: GEMINI_JSON }] } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

describe("résilience transport Gemini", () => {
  it("bascule sur le modèle suivant après deux erreurs réseau fetch", async () => {
    vi.useFakeTimers();
    const urls: string[] = [];
    const fetchSpy = vi.fn(async (url: string) => {
      urls.push(url);
      if (urls.length <= 2) throw new TypeError("fetch failed");
      return responseOk();
    });
    vi.stubGlobal("fetch", fetchSpy);

    const provider = createProviderFromConfig({
      type: "gemini",
      apiKey: "AIzaFake",
      timeoutMs: 5000,
    });

    const promise = provider!.parse({ kind: "text", text: "Catalogue" });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual(JSON.parse(GEMINI_JSON));

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(urls[0]).toContain("gemini-3.6-flash");
    expect(urls[1]).toContain("gemini-3.6-flash");
    expect(urls[2]).toContain("gemini-3.7-flash");
  });

  it("respecte Retry-After sur une réponse 429 avant la nouvelle tentative", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchSpy = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { message: "busy" } }), {
          status: 429,
          headers: { "retry-after": "2" },
        });
      }
      return responseOk();
    });
    vi.stubGlobal("fetch", fetchSpy);

    const provider = createProviderFromConfig({
      type: "gemini",
      apiKey: "AIzaFake",
      timeoutMs: 5000,
    });

    const promise = provider!.parse({ kind: "text", text: "Catalogue" });
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toEqual(JSON.parse(GEMINI_JSON));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
