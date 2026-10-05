import { afterEach, describe, expect, it, vi } from "vitest";
import { IMPORT_TARGET_FIELDS } from "../types";
import {
  createProviderFromConfig,
  resolveProviderConfig,
  type Provider,
} from "./provider";

// ---------------------------------------------------------------------------
// Configuration fournisseur — env réel lu côté serveur, jamais journalisé
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("resolveProviderConfig", () => {
  it("sans clé : aucun fournisseur (aucune requête possible)", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(resolveProviderConfig()).toBeNull();
  });

  it("GEMINI_API_KEY : fournisseur google configuré (changement minimal accepté)", () => {
    vi.stubEnv("GEMINI_API_KEY", "AIzaFakeTestKey123456789");
    vi.stubEnv("OPENAI_API_KEY", "");
    const config = resolveProviderConfig();
    expect(config).not.toBeNull();
    expect(config?.type).toBe("gemini");
  });

  it("OPENAI_API_KEY avec clé Google (AIza...) : fournisseur google, pas openai", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", '"AIzaFakeGoogleKey1234567"');
    const config = resolveProviderConfig();
    expect(config?.type).toBe("gemini");
  });

  it("OPENAI_API_KEY avec clé sk- : fournisseur openai-compatible", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-proj-fake123");
    const config = resolveProviderConfig();
    expect(config?.type).toBe("openai");
  });

  it("clé au format inconnu : incompatible, aucun fournisseur (pas d'appel modèle)", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", '"quelquechoseinconnu123"');
    expect(resolveProviderConfig()).toBeNull();
  });

  it("ne journalise jamais la valeur de la clé", () => {
    vi.stubEnv("GEMINI_API_KEY", "AIzaFakeSecretValue1234567890");
    const spy = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const err = vi.spyOn(console, "error");
    resolveProviderConfig();
    expect(spy).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    spy.mockRestore();
    warn.mockRestore();
    err.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Appels fournisseur — fetch mocké, zéro vraie clé dans la suite
// ---------------------------------------------------------------------------

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal("fetch", spy);
  return spy;
}

const GEMINI_JSON = JSON.stringify({
  candidates: [
    {
      entityType: "product",
      fields: { name: { raw: "Savon", confidence: "high", page: 1 } },
    },
  ],
});

describe("provider.parse — google (Gemini)", () => {
  it("appelle generateContent et retourne le JSON brut", async () => {
    const spy = stubFetch((url, init) => {
      expect(url).toContain("generativelanguage.googleapis.com");
      expect(url).toContain("generateContent");
      expect(url).not.toContain("AIzaFake");
      const headers = init?.headers as Record<string, string>;
      expect(headers["x-goog-api-key"]).toBe("AIzaFakeTestKey123456789");
      const body = JSON.parse(String(init?.body));
      expect(body.contents).toBeDefined();
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: GEMINI_JSON }] } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const provider = createProviderFromConfig({
      type: "gemini",
      apiKey: "AIzaFakeTestKey123456789",
      timeoutMs: 5000,
    });
    expect(provider).not.toBeNull();
    const out = await provider!.parse({ kind: "text", text: "Catalogue savon" });
    expect(out).toEqual(JSON.parse(GEMINI_JSON));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("contrat d'extraction — prompt et schéma alignés sur IMPORT_TARGET_FIELDS", () => {
  async function geminiBody(): Promise<unknown> {
    const spy = stubFetch(
      () =>
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: GEMINI_JSON }] } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );
    const provider = createProviderFromConfig({
      type: "gemini",
      apiKey: "AIzaFake",
      timeoutMs: 5000,
    });
    await provider!.parse({ kind: "text", text: "Catalogue" });
    return JSON.parse(String(spy.mock.calls[0][1]?.body)) as unknown;
  }

  function get(value: unknown, path: readonly string[]): unknown {
    return path.reduce<unknown>(
      (acc, key) =>
        typeof acc === "object" && acc !== null
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      value
    );
  }

  it("demande une sortie JSON structurée (responseFormat.text + schéma)", async () => {
    const body = await geminiBody();
    expect(get(body, ["generationConfig", "responseFormat", "text", "mimeType"])).toBe(
      "APPLICATION_JSON"
    );
    const schema = get(body, ["generationConfig", "responseFormat", "text", "schema"]);
    expect(get(schema, ["type"])).toBe("OBJECT");

    // Paramètres d'échantillonnage dépréciés sur Gemini 3 : jamais envoyés.
    for (const param of ["temperature", "topP", "topK", "candidateCount", "thinkingConfig"]) {
      expect(get(body, ["generationConfig", param])).toBeUndefined();
    }
    const properties = (get(schema, ["properties"]) ?? {}) as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual(["categories", "customers", "products", "suppliers"]);

    // Chaque tableau n'accepte QUE les champs de son propre type d'entité.
    const groupKeys: Record<string, keyof typeof IMPORT_TARGET_FIELDS> = {
      categories: "category",
      products: "product",
      customers: "customer",
      suppliers: "supplier",
    };
    for (const [group, entity] of Object.entries(groupKeys)) {
      const items = (get(schema, ["properties", group, "items", "properties"]) ??
        {}) as Record<string, unknown>;
      const keys = Object.keys(items)
        .filter((key) => key !== "page")
        .sort();
      expect(keys).toEqual([...IMPORT_TARGET_FIELDS[entity]].sort());
      expect(items.name).toBeDefined();
      // Tous les champs sont déclarés (sinon le modèle n'en extrait qu'une partie).
      const required = (get(schema, ["properties", group, "items", "required"]) ?? []) as string[];
      expect(required).toEqual(expect.arrayContaining([...IMPORT_TARGET_FIELDS[entity], "page"]));
    }
    const productKeys = Object.keys(
      get(schema, ["properties", "products", "items", "properties"]) as object
    );
    expect(productKeys).not.toContain("phone");
    expect(productKeys).not.toContain("email");
  });

  it("le prompt ne cite que les noms de champs exacts de la Phase 2", async () => {
    const body = await geminiBody();
    const contents = (get(body, ["contents"]) ?? []) as Array<{ parts?: Array<{ text?: string }> }>;
    const parts = contents[0]?.parts ?? [];
    const prompt = parts.map((part) => part.text ?? "").join("");
    expect(prompt).not.toMatch(/name, price/);
    for (const list of Object.values(IMPORT_TARGET_FIELDS)) {
      expect(prompt).toContain(list.join(", "));
    }
    expect(prompt).toContain("min_stock_threshold");
  });

  it("réponse groupée (un tableau par entité) ramenée au contrat {candidates:[...]}", async () => {
    const grouped = JSON.stringify({
      categories: [],
      products: [
        {
          name: { raw: "Savon", confidence: "high", page: 1 },
          unit: { raw: "pièce", confidence: "high", page: 1 },
          cost_price: null,
          sale_price: null,
          page: 1,
        },
      ],
      customers: [{ name: { raw: "Marché Akoé", confidence: "medium" } }],
      suppliers: [],
    });
    stubFetch(
      () =>
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: grouped }] } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );
    const provider = createProviderFromConfig({
      type: "gemini",
      apiKey: "AIzaFake",
      timeoutMs: 5000,
    });
    const out = (await provider!.parse({ kind: "text", text: "x" })) as {
      candidates: Array<{ entityType: string; fields: Record<string, unknown>; page?: number }>;
    };
    expect(out.candidates.map((candidate) => candidate.entityType)).toEqual(["product", "customer"]);
    expect(Object.keys(out.candidates[0].fields).sort()).toEqual(["name", "unit"]);
    expect(out.candidates[0].page).toBe(1);
    expect(out.candidates[1].page).toBeUndefined();
  });

  it("réponse entourée de fences ```json : lue malgré tout", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "```json\n" + GEMINI_JSON + "\n```" }] } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    );
    const provider = createProviderFromConfig({
      type: "gemini",
      apiKey: "AIzaFake",
      timeoutMs: 5000,
    });
    expect(await provider!.parse({ kind: "text", text: "x" })).toEqual(JSON.parse(GEMINI_JSON));
  });

  it("réponse avec texte autour de l'objet JSON : extraction de l'objet", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: `Voici le résultat :\n${GEMINI_JSON}` }] } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    );
    const provider = createProviderFromConfig({
      type: "gemini",
      apiKey: "AIzaFake",
      timeoutMs: 5000,
    });
    expect(await provider!.parse({ kind: "text", text: "x" })).toEqual(JSON.parse(GEMINI_JSON));
  });
});

describe("provider.parse — openai-compatible", () => {
  it("appelle chat/completions et retourne le JSON brut", async () => {
    const spy = stubFetch((url, init) => {
      expect(url).toContain("api.openai.com");
      expect(url).toContain("chat/completions");
      const body = JSON.parse(String(init?.body));
      expect(body.messages).toBeDefined();
      return new Response(
        JSON.stringify({ choices: [{ message: { content: GEMINI_JSON } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const provider = createProviderFromConfig({
      type: "openai",
      apiKey: "sk-proj-fake",
      timeoutMs: 5000,
    });
    const out = await provider!.parse({ kind: "text", text: "Catalogue" });
    expect(out).toEqual(JSON.parse(GEMINI_JSON));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("robustesse fournisseur", () => {
  it("erreur HTTP : message propre sans clé", async () => {
    stubFetch(() => new Response("boom", { status: 400 }));
    const provider = createProviderFromConfig({
      type: "gemini",
      apiKey: "AIzaFakeSecretKeyDoNotLeak",
      timeoutMs: 5000,
    });
    await expect(provider!.parse({ kind: "text", text: "x" })).rejects.toThrow();
    try {
      await provider!.parse({ kind: "text", text: "x" });
    } catch (e) {
      const message = (e as Error).message;
      expect(message).not.toContain("AIzaFakeSecretKeyDoNotLeak");
      expect(message).toMatch(/fournisseur|IA|modèle/i);
    }
  });

  it("réponse modèle non-JSON (JSON mal formé) : rejet propre", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ceci n'est pas du json" }] } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );
    const provider = createProviderFromConfig({
      type: "gemini",
      apiKey: "AIzaFake",
      timeoutMs: 5000,
    });
    await expect(provider!.parse({ kind: "text", text: "x" })).rejects.toThrow(/JSON/i);
  });

  it("erreur réseau (fetch rejette) : erreur fournisseur transitoire normalisée", async () => {
    stubFetch(() => Promise.reject(new Error("fetch failed")));
    const provider = createProviderFromConfig({
      type: "openai",
      apiKey: "sk-fake",
      timeoutMs: 5000,
    });
    await expect(provider!.parse({ kind: "text", text: "x" })).rejects.toThrow(
      "Erreur réseau lors de l'appel au fournisseur IA"
    );
  });

  it("image : envoie base64 + mimeType au fournisseur", async () => {
    const spy = stubFetch((url) => {
      expect(url).toContain("generativelanguage.googleapis.com");
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: GEMINI_JSON }] } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const provider = createProviderFromConfig({
      type: "gemini",
      apiKey: "AIzaFake",
      timeoutMs: 5000,
    });
    await provider!.parse({ kind: "image", mimeType: "image/png", base64: "aGVsbG8=" });
    expect(spy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(spy.mock.calls[0][1]?.body));
    expect(JSON.stringify(body)).toContain("aGVsbG8=");
  });

  it("timeout appliqué via AbortSignal", async () => {
    stubFetch((_url, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const provider = createProviderFromConfig({
      type: "openai",
      apiKey: "sk-fake",
      timeoutMs: 1234,
    });
    await provider!.parse({ kind: "text", text: "x" });
  });
});

describe("résilience fournisseur Gemini", () => {
  it("bascule sur le modèle suivant après une panne réseau persistante", async () => {
    const urls: string[] = [];
    const spy = stubFetch((url) => {
      urls.push(url);
      if (urls.length < 3) {
        return Promise.reject(new TypeError("fetch failed"));
      }
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: GEMINI_JSON }] } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const provider = createProviderFromConfig({
      type: "gemini",
      apiKey: "AIzaFake",
      timeoutMs: 5000,
      model: "gemini-3.6-flash",
    });

    await expect(provider!.parse({ kind: "text", text: "Catalogue" })).resolves.toEqual(
      JSON.parse(GEMINI_JSON)
    );
    expect(spy).toHaveBeenCalledTimes(3);
    expect(urls[0]).toContain("gemini-3.6-flash");
    expect(urls[1]).toContain("gemini-3.6-flash");
    expect(urls[2]).toContain("gemini-3.7-flash");
  });

  it("bascule sur le modèle suivant après timeout/AbortError", async () => {
    const urls: string[] = [];
    const spy = stubFetch((url) => {
      urls.push(url);
      if (urls.length < 3) {
        return Promise.reject(
          new DOMException("The operation was aborted.", "AbortError")
        );
      }
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: GEMINI_JSON }] } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const provider = createProviderFromConfig({
      type: "gemini",
      apiKey: "AIzaFake",
      timeoutMs: 5000,
      model: "gemini-3.6-flash",
    });

    await expect(provider!.parse({ kind: "text", text: "Catalogue" })).resolves.toEqual(
      JSON.parse(GEMINI_JSON)
    );
    expect(spy).toHaveBeenCalledTimes(3);
    expect(urls[2]).toContain("gemini-3.7-flash");
  });

  it("respecte Retry-After avant la nouvelle tentative", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const spy = stubFetch(() => {
        calls += 1;
        if (calls === 1) {
          return new Response(JSON.stringify({ error: { message: "busy" } }), {
            status: 429,
            headers: { "Retry-After": "0.2" },
          });
        }
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: GEMINI_JSON }] } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const provider = createProviderFromConfig({
        type: "gemini",
        apiKey: "AIzaFake",
        timeoutMs: 5000,
      });

      const pending = provider!.parse({ kind: "text", text: "Catalogue" });
      await vi.advanceTimersByTimeAsync(199);
      expect(spy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual(JSON.parse(GEMINI_JSON));
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });


  it("retente une erreur 429 transitoire puis réussit", async () => {
    let calls = 0;
    const spy = stubFetch((url) => {
      calls += 1;
      expect(url).toContain("gemini-3.6-flash");
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { message: "busy" } }), { status: 429 });
      }
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: GEMINI_JSON }] } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const provider = createProviderFromConfig({
      type: "gemini",
      apiKey: "AIzaFake",
      timeoutMs: 5000,
    });
    await expect(provider!.parse({ kind: "text", text: "Catalogue" })).resolves.toEqual(
      JSON.parse(GEMINI_JSON)
    );
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("bascule sur le modèle de secours après saturation persistante", async () => {
    const urls: string[] = [];
    const spy = stubFetch((url) => {
      urls.push(url);
      if (urls.length < 3) {
        return new Response(JSON.stringify({ error: { message: "busy" } }), { status: 503 });
      }
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: GEMINI_JSON }] } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const provider = createProviderFromConfig({
      type: "gemini",
      apiKey: "AIzaFake",
      timeoutMs: 5000,
      model: "gemini-3.6-flash",
    });
    await provider!.parse({ kind: "text", text: "Catalogue" });

    expect(spy).toHaveBeenCalledTimes(3);
    expect(urls[0]).toContain("gemini-3.6-flash");
    expect(urls[1]).toContain("gemini-3.6-flash");
    expect(urls[2]).toContain("gemini-3.7-flash");
  });

  it("bascule sur Gemini 3.5 si 3.6 et 3.7 restent saturés", async () => {
    const urls: string[] = [];
    const spy = stubFetch((url) => {
      urls.push(url);
      if (urls.length < 5) {
        return new Response(JSON.stringify({ error: { message: "busy" } }), { status: 429 });
      }
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: GEMINI_JSON }] } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const provider = createProviderFromConfig({
      type: "gemini",
      apiKey: "AIzaFake",
      timeoutMs: 5000,
    });

    await provider!.parse({ kind: "text", text: "Catalogue" });

    expect(spy).toHaveBeenCalledTimes(5);
    expect(urls[0]).toContain("gemini-3.6-flash");
    expect(urls[1]).toContain("gemini-3.6-flash");
    expect(urls[2]).toContain("gemini-3.7-flash");
    expect(urls[3]).toContain("gemini-3.7-flash");
    expect(urls[4]).toContain("gemini-3.5-flash");
  });

  it("envoie un PDF brut à Gemini pour le fallback documentaire", async () => {
    const spy = stubFetch(() =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: GEMINI_JSON }] } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const provider = createProviderFromConfig({
      type: "gemini",
      apiKey: "AIzaFake",
      timeoutMs: 5000,
    });
    await provider!.parse({
      kind: "document",
      mimeType: "application/pdf",
      base64: "JVBERi0xLjQ=",
    });

    const body = JSON.parse(String(spy.mock.calls[0][1]?.body));
    const parts = body.contents?.[0]?.parts ?? [];
    expect(parts.some((part: { inline_data?: { mime_type?: string; data?: string } }) =>
      part.inline_data?.mime_type === "application/pdf" &&
      part.inline_data?.data === "JVBERi0xLjQ="
    )).toBe(true);
  });
});

describe("createProviderFromConfig", () => {
  it("retourne null sans config (aucun appel modèle possible)", () => {
    expect(createProviderFromConfig(null)).toBeNull();
  });
});

describe("contrat Provider", () => {
  it("expose un nom stable", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );
    const provider: Provider | null = createProviderFromConfig({
      type: "gemini",
      apiKey: "AIzaFake",
      timeoutMs: 5000,
    });
    expect(typeof provider?.name).toBe("string");
  });
});
