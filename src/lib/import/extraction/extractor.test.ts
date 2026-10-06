import { deflateRawSync, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { MAX_DECOMPRESSED_BYTES } from "./decompression";
import {
  createDocumentExtractor,
  composeProviderTextChunks,
  parseDocumentLocally,
  parsePersistedArtifact,
  structureParsedDocument,
  type Provider,
} from "./extractor";
import { ProviderHttpError, ProviderTransportError } from "./provider";
import type { ExtractedDocument } from "./types";

// ---------------------------------------------------------------------------
// Fakes — jamais de clé API réelle dans la suite
// ---------------------------------------------------------------------------

const DOC_ID = "33333333-3333-4333-8333-333333333333";

function fakeProvider(result: unknown, name = "fake-provider"): Provider {
  return {
    name,
    async parse() {
      return result;
    },
  };
}

function failingProvider(message: string): Provider {
  return {
    name: "failing-provider",
    async parse() {
      throw new Error(message);
    },
  };
}

const VALID_OUTPUT = {
  candidates: [
    {
      entityType: "product",
      fields: {
        name: { raw: "Huile de palme 1L", confidence: "high", page: 1 },
        sale_price: { raw: "2500", confidence: "medium", page: 1 },
      },
    },
  ],
};

async function run(
  sourceKind: string,
  bytes: Uint8Array,
  provider: Provider | null = fakeProvider(VALID_OUTPUT),
  filename = `doc.${sourceKind}`
): Promise<ExtractedDocument> {
  const extractor = createDocumentExtractor({ provider });
  return extractor.extract({
    documentId: DOC_ID,
    sourceKind: sourceKind as never,
    filename,
    bytes,
  });
}

const enc = (s: string) => new TextEncoder().encode(s);

// ---------------------------------------------------------------------------
// 1-4. Formats V1 valides
// ---------------------------------------------------------------------------

describe("formats V1 valides", () => {
  it("extrait le texte d'un Markdown valide (lecture directe)", async () => {
    const doc = await run(
      "md",
      enc("# Catalogue\n\nHuile de palme 1L — 2500 FCFA\n")
    );
    expect(doc.status).toBe("SUCCESS");
    expect(doc.documentId).toBe(DOC_ID);
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0].text).toContain("Huile de palme 1L");
    expect(doc.candidates.length).toBeGreaterThan(0);
    expect(doc.errors).toHaveLength(0);
  });

  it("extrait le texte d'un DOCX valide avec les paragraphes", async () => {
    const doc = await run("docx", makeDocxBytes(["Facture ACME SARL", "Total: 45000 FCFA"]));
    expect(doc.status).toBe("SUCCESS");
    const allText = doc.pages.map((p) => p.text).join("\n");
    expect(allText).toContain("Facture ACME SARL");
    expect(allText).toContain("Total: 45000 FCFA");
  });

  it("extrait le texte d'un PDF valide en conservant les pages", async () => {
    const doc = await run(
      "pdf",
      makePdfBytes([
        "Bienvenue sur la page 1 : Huile de palme",
        "Suite page 2 : Tarif 2500 FCFA",
      ])
    );
    expect(doc.status).toBe("SUCCESS");
    expect(doc.pages).toHaveLength(2);
    expect(doc.pages[0].page).toBe(1);
    expect(doc.pages[1].page).toBe(2);
    expect(doc.pages[0].text).toContain("page 1");
    expect(doc.pages[1].text).toContain("page 2");
  });

  it("préserve les retours ligne, les tableaux et les parties auxiliaires DOCX", async () => {
    const doc = await run("docx", makeRichDocxBytes());
    expect(doc.status).toBe("SUCCESS");
    const text = doc.pages.map((page) => page.text).join("\n");

    expect(text).toContain("Produit A\t2500 FCFA\nSuite A");
    expect(text).toContain("Produit\tPrix\nHuile de palme 1L\t2500 FCFA");
    expect(text).toContain("[HEADER]\nKAZA Catalogue");
    expect(text).toContain("[FOOTER]\nConfidentiel");
    expect(text).toContain("[FOOTNOTES]\nPrix hors taxe");
  });

  it("ne décompresse pas les médias DOCX non nécessaires au texte", async () => {
    const doc = await run("docx", makeRichDocxBytes(true));
    expect(doc.status).toBe("SUCCESS");
    expect(doc.pages[0].text).toContain("Huile de palme 1L");
  });

  it("extrait la texte d'un DOCX compressé (méthode zip deflate)", async () => {
    const doc = await run("docx", makeDocxBytes(["Ligne deflate 1", "Ligne deflate 2"], true));
    expect(doc.status).toBe("SUCCESS");
    const allText = doc.pages.map((p) => p.text).join("\n");
    expect(allText).toContain("Ligne deflate 1");
    expect(allText).toContain("Ligne deflate 2");
  });

  it("extrait le texte d'un PDF aux flux FlateDecode compressés", async () => {
    const doc = await run("pdf", makePdfBytes(["Texte compressé page 1", "Suite page 2"], true));
    expect(doc.status).toBe("SUCCESS");
    expect(doc.pages).toHaveLength(2);
    expect(doc.pages[0].text).toContain("Texte compressé page 1");
    expect(doc.pages[1].text).toContain("Suite page 2");
  });

  it("extrait le texte d'un DOC binaire (best-effort, chaînes lisibles)", async () => {
    const binary = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.from("Facture ACME SARL total 45000 FCFA", "latin1"),
      Buffer.from([0x00, 0x01, 0xff]),
    ]);
    const doc = await run("doc", new Uint8Array(binary));
    expect(doc.status).toBe("SUCCESS");
    const allText = doc.pages.map((p) => p.text).join("\n");
    expect(allText).toContain("Facture ACME SARL");
    expect(allText).toContain("45000 FCFA");
  });

  it("extrait les chaînes ASCII stockées en UTF-16LE dans un DOC legacy", async () => {
    const text = "Facture ACME SARL 45000 FCFA";
    const utf16 = Buffer.from(text, "utf16le");
    const binary = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.from([0x00, 0x01, 0xff]),
      utf16,
    ]);
    const doc = await run("doc", new Uint8Array(binary));

    expect(doc.status).toBe("SUCCESS");
    const allText = doc.pages.map((p) => p.text).join("\n");
    expect(allText).toContain(text);
  });

  it("extrait une image via le fournisseur IA multimodal", async () => {
    const provider: Provider = {
      name: "multimodal",
      async parse(request) {
        expect(request.kind).toBe("image");
        if (request.kind === "image") {
          expect(request.mimeType).toBe("image/png");
          expect(typeof request.base64).toBe("string");
        }
        return VALID_OUTPUT;
      },
    };
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1, 2, 3]);
    const extractor = createDocumentExtractor({ provider });
    const doc = await extractor.extract({
      documentId: DOC_ID,
      sourceKind: "image",
      filename: "photo.png",
      bytes: png,
    });
    expect(doc.status).toBe("SUCCESS");
    expect(doc.candidates.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Parsing local durable
// ---------------------------------------------------------------------------

describe("artefact de parsing durable", () => {
  it("produit un artefact versionné réutilisable après lecture locale", () => {
    const result = parseDocumentLocally({
      documentId: DOC_ID,
      sourceKind: "md",
      filename: "catalogue.md",
      bytes: enc("Produit A — 10 000 FCFA"),
    });

    expect(result.status).toBe("READY");
    if (result.status !== "READY") return;
    expect(result.artifact.version).toBe(1);
    expect(result.artifact.source).toBe("markdown-local");
    expect(result.artifact.pages).toEqual([
      { page: 1, text: "Produit A — 10 000 FCFA" },
    ]);

    expect(parsePersistedArtifact(JSON.parse(JSON.stringify(result.artifact)))).toEqual(
      result.artifact
    );
  });

  it("refuse un artefact persistant malformé plutôt que de le traiter aveuglément", () => {
    expect(
      parsePersistedArtifact({
        version: 1,
        source: "markdown-local",
        pages: [{ page: 0, text: "x" }],
        warnings: [],
      })
    ).toBeNull();

    expect(parsePersistedArtifact({
      version: 2,
      source: "markdown-local",
      pages: [],
      warnings: [],
    })).toBeNull();
  });

  it("structure un artefact déjà parsé sans reparcourir le document", async () => {
    const artifact = {
      version: 1 as const,
      source: "markdown-local",
      pages: [{ page: 1, text: "Produit A — 10 000 FCFA" }],
      warnings: [],
    };

    const doc = await structureParsedDocument(
      {
        documentId: DOC_ID,
        sourceKind: "md",
        filename: "catalogue.md",
        bytes: new Uint8Array(),
      },
      artifact,
      fakeProvider(VALID_OUTPUT)
    );

    expect(doc.status).toBe("SUCCESS");
    expect(doc.pages).toEqual(artifact.pages);
    expect(doc.candidates).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Format interdit
// ---------------------------------------------------------------------------

describe("signature binaire", () => {
  it("refuse un PDF dont la signature ne correspond pas au format annoncé", async () => {
    const doc = await run("pdf", enc("ceci est du texte, pas un PDF"));
    expect(doc.status).toBe("FAILED");
    expect(doc.errors[0]?.code).toBe("INVALID_FILE_SIGNATURE");
  });

  it("refuse une image PNG usurpée avec un contenu arbitraire", async () => {
    const doc = await run("image", enc("not a png"), null, "photo.png");
    expect(doc.status).toBe("FAILED");
    expect(doc.errors[0]?.code).toBe("INVALID_FILE_SIGNATURE");
  });

  it("accepte les signatures natives des formats binaires V1", async () => {
    const pdf = await run("pdf", enc("%PDF-1.7\n"), null);
    expect(pdf.errors[0]?.code).not.toBe("INVALID_FILE_SIGNATURE");

    const docx = await run("docx", new Uint8Array([0x50, 0x4b, 0x03, 0x04]), null);
    expect(docx.errors[0]?.code).not.toBe("INVALID_FILE_SIGNATURE");

    const doc = await run(
      "doc",
      new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      null
    );
    expect(doc.errors[0]?.code).not.toBe("INVALID_FILE_SIGNATURE");

    const png = await run(
      "image",
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      null,
      "photo.png"
    );
    expect(png.errors[0]?.code).not.toBe("INVALID_FILE_SIGNATURE");
  });
});

describe("format interdit", () => {
  it("refuse proprement un format hors V1 sans appel fournisseur", async () => {
    let providerCalled = false;
    const provider: Provider = {
      name: "spy",
      async parse() {
        providerCalled = true;
        return VALID_OUTPUT;
      },
    };
    const extractor = createDocumentExtractor({ provider });
    const doc = await extractor.extract({
      documentId: DOC_ID,
      sourceKind: "xlsx",
      filename: "tableur.xlsx",
      bytes: enc("PK..."),
    });
    expect(doc.status).toBe("FAILED");
    expect(doc.errors[0]?.message).toMatch(/non supporté/);
    expect(providerCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6-7. Document vide / illisible
// ---------------------------------------------------------------------------

describe("documents inutilisables", () => {
  it("échoue sur un document vide (0 octet)", async () => {
    const doc = await run("md", new Uint8Array(0));
    expect(doc.status).toBe("FAILED");
    expect(doc.errors.length).toBeGreaterThan(0);
    expect(doc.candidates).toHaveLength(0);
  });

  it("échoue sur un document illisible (données corrompues)", async () => {
    const doc = await run("pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x00, 0x11]), null);
    expect(doc.status).toBe("FAILED");
    expect(doc.errors.length).toBeGreaterThan(0);
  });

  it("utilise Gemini comme fallback visuel pour un PDF sans texte local", async () => {
    const calls: Array<{ kind: string; mimeType?: string; base64?: string }> = [];
    const provider: Provider = {
      name: "pdf-vision",
      async parse(request) {
        calls.push(request);
        expect(request.kind).toBe("document");
        if (request.kind === "document") {
          expect(request.mimeType).toBe("application/pdf");
          expect(request.base64).toBeTruthy();
        }
        return VALID_OUTPUT;
      },
    };

    const unreadablePdf = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x00, 0xff, 0xfe, 0x00,
    ]);
    const doc = await run("pdf", unreadablePdf, provider);

    expect(doc.status).toBe("SUCCESS");
    expect(doc.source).toBe("pdf-llm");
    expect(doc.candidates.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
  });

});

// ---------------------------------------------------------------------------
// 8-9. Multi-page + provenance page conservée
// ---------------------------------------------------------------------------

describe("pages et provenance", () => {
  it("conserve la provenance page de chaque candidat quand la pagination est fiable", async () => {
    const output = {
      candidates: [
        {
          entityType: "product",
          fields: {
            name: { raw: "Sucre 1kg", confidence: "high", page: 2 },
          },
        },
      ],
    };
    const doc = await run("pdf", makePdfBytes(["page un", "page deux"]), fakeProvider(output));
    expect(doc.candidates[0].page).toBe(2);
    expect(doc.candidates[0].fields.name?.page).toBe(2);
  });

  it("multi-page : chaque page extrait est numérotée", async () => {
    const doc = await run(
      "pdf",
      makePdfBytes(["alpha contenu", "beta contenu", "gamma contenu"])
    );
    expect(doc.pages.map((p) => p.page)).toEqual([1, 2, 3]);
  });

  it("résout un /Resources inline et un /ToUnicode multi-code UTF-16", async () => {
    const doc = await run("pdf", makePdfInlineUnicodeBytes());

    expect(doc.status).toBe("SUCCESS");
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0]?.text).toContain("Pérou");
  });

  it("neutralise une citation de page DOCX parce que la pagination native est indisponible", async () => {
    const output = {
      candidates: [
        {
          entityType: "product",
          fields: {
            name: { raw: "Facture ACME SARL", confidence: "high", page: 7 },
          },
        },
      ],
    };

    const doc = await run(
      "docx",
      makeDocxBytes(["Facture ACME SARL"]),
      fakeProvider(output)
    );

    expect(doc.status).toBe("SUCCESS");
    expect(doc.candidates[0]?.page).toBeNull();
    expect(doc.candidates[0]?.fields.name?.page).toBeNull();
    expect(doc.candidates[0]?.fields.name?.confidence).toBe("low");
    expect(doc.candidates[0]?.fields.name?.warning).toMatch(/pagination/i);
    expect(doc.warnings.some((warning) => warning.code === "PAGES_UNAVAILABLE")).toBe(true);
  });

  it("rend toute sortie DOC legacy explicitement incertaine", async () => {
    const output = {
      candidates: [
        {
          entityType: "product",
          fields: {
            name: { raw: "Facture ACME SARL", confidence: "high", page: 1 },
          },
        },
      ],
    };

    const binary = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.from("Facture ACME SARL", "latin1"),
    ]);

    const doc = await run("doc", new Uint8Array(binary), fakeProvider(output));

    expect(doc.status).toBe("SUCCESS");
    expect(doc.candidates[0]?.page).toBeNull();
    expect(doc.candidates[0]?.fields.name?.confidence).toBe("low");
    expect(doc.candidates[0]?.fields.name?.warning).toMatch(/best-effort/i);
  });

  it("rend non vérifiable une citation PDF quand l'arbre de pagination manque", async () => {
    const output = {
      candidates: [
        {
          entityType: "product",
          fields: {
            name: { raw: "Sans arbre", confidence: "high", page: 1 },
          },
        },
      ],
    };

    const pdf = new TextEncoder().encode(
      "%PDF-1.7\n10 0 obj <</Type/Page/Contents 11 0 R>> endobj\n11 0 obj <</Length 32>> stream\nBT (Sans arbre) Tj ET\nendstream endobj\n%%EOF"
    );

    const doc = await run("pdf", pdf, fakeProvider(output));

    expect(doc.status).toBe("SUCCESS");
    expect(doc.candidates[0]?.page).toBeNull();
    expect(doc.candidates[0]?.fields.name?.page).toBeNull();
    expect(doc.candidates[0]?.fields.name?.confidence).toBe("low");
    expect(doc.candidates[0]?.fields.name?.warning).toMatch(/pagination/i);
  });
});

// ---------------------------------------------------------------------------
// 10-12. Raw, absence → missing, confiance
// ---------------------------------------------------------------------------

describe("raw / confiance / absences", () => {
  it("conserve la valeur brute (raw) trouvée dans le document", async () => {
    const doc = await run("md", enc("contenu"), fakeProvider(VALID_OUTPUT));
    expect(doc.candidates[0].fields.name?.raw).toBe("Huile de palme 1L");
    expect(doc.candidates[0].fields.sale_price?.raw).toBe("2500");
  });

  it("information absente : le champ reste absent (jamais inventé)", async () => {
    const output = {
      candidates: [
        {
          entityType: "product",
          fields: {
            name: { raw: "Savon noir", confidence: "high", page: 1 },
          },
        },
      ],
    };
    const doc = await run("md", enc("Savon noir"), fakeProvider(output));
    expect(doc.candidates[0].fields).not.toHaveProperty("sale_price");
    expect(doc.candidates[0].fields).not.toHaveProperty("stock_quantity");
    expect(JSON.stringify(doc.candidates)).not.toContain("normalized");
  });

  it("conserve la confiance de chaque champ", async () => {
    // Le document contient réellement les valeurs annoncées : la confiance
    // déclarée par le modèle est conservée. (Une valeur absente du document
    // est, elle, rétrogradée — cf. "provenance" plus bas.)
    const doc = await run(
      "md",
      enc("Huile de palme 1L — 2500 FCFA"),
      fakeProvider(VALID_OUTPUT)
    );
    expect(doc.candidates[0].fields.name?.confidence).toBe("high");
    expect(doc.candidates[0].fields.sale_price?.confidence).toBe("medium");
  });

  it("conserve documentId sur chaque candidat", async () => {
    const doc = await run("md", enc("contenu"), fakeProvider(VALID_OUTPUT));
    expect(doc.candidates[0].documentId).toBe(DOC_ID);
  });
});

// ---------------------------------------------------------------------------
// 18-19. Timeout / erreur fournisseur
// ---------------------------------------------------------------------------

describe("erreurs fournisseur structurées", () => {
  it("convertit un 429 provider en erreur d'extraction structurée sans exposer le message brut", async () => {
    const provider: Provider = {
      name: "gemini",
      async parse() {
        throw new ProviderHttpError("quota interne: secret", 429, {
          details: {
            provider: "gemini",
            model: "gemini-3.6-flash",
            category: "rate_limit",
            retryable: true,
            providerCode: "RESOURCE_EXHAUSTED",
            retryAfterMs: 1500,
            requestId: "req-429",
          },
        });
      },
    };

    const doc = await run("md", enc("Produit A"), provider);

    expect(doc.status).toBe("PARTIAL");
    expect(doc.candidates).toHaveLength(0);
    expect(doc.errors[0]).toMatchObject({
      code: "PROVIDER_RATE_LIMIT",
      message: "Le fournisseur IA est temporairement saturé ; une nouvelle tentative est possible.",
      provider: {
        provider: "gemini",
        model: "gemini-3.6-flash",
        category: "rate_limit",
        retryable: true,
        status: 429,
        providerCode: "RESOURCE_EXHAUSTED",
        retryAfterMs: 1500,
        requestId: "req-429",
      },
    });
    expect(doc.errors[0]?.message).not.toContain("quota interne");
  });

  it("convertit un timeout multimodal en PROVIDER_TIMEOUT sans perdre la confidentialité", async () => {
    const provider: Provider = {
      name: "gemini",
      async parse() {
        throw new ProviderTransportError(
          "timeout interne",
          {
            details: {
              provider: "gemini",
              model: "gemini-3.6-flash",
              category: "timeout",
              retryable: true,
            },
          }
        );
      },
    };

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    const doc = await createDocumentExtractor({ provider }).extract({
      documentId: DOC_ID,
      sourceKind: "image",
      filename: "photo.png",
      bytes: png,
    });

    expect(doc.status).toBe("FAILED");
    expect(doc.errors[0]).toMatchObject({
      code: "PROVIDER_TIMEOUT",
      provider: {
        category: "timeout",
        retryable: true,
      },
    });
  });
});

describe("robustesse fournisseur", () => {
  it("timeout du fournisseur : échec propre, texte conservé en PARTIAL", async () => {
    const timeoutProvider: Provider = {
      name: "slow",
      async parse() {
        await new Promise((r) => setTimeout(r, 5));
        throw new Error("Aborted after 30000ms");
      },
    };
    const doc = await run("md", enc("Texte réel du document"), timeoutProvider);
    expect(doc.status).toBe("PARTIAL");
    expect(doc.candidates).toHaveLength(0);
    expect(doc.pages[0].text).toContain("Texte réel du document");
    expect(doc.errors.length).toBeGreaterThan(0);
  });

  it("erreur réseau fournisseur : jamais de candidat inventé", async () => {
    const doc = await run("md", enc("texte utile"), failingProvider("fetch failed"));
    expect(doc.status).toBe("PARTIAL");
    expect(doc.candidates).toHaveLength(0);
    expect(doc.errors[0]?.message).toMatch(/fetch failed/);
  });

  it("image sans fournisseur configuré : FAILED, aucun candidat", async () => {
    const extractor = createDocumentExtractor({ provider: null });
    const doc = await extractor.extract({
      documentId: DOC_ID,
      sourceKind: "image",
      filename: "photo.jpg",
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    });
    expect(doc.status).toBe("FAILED");
    expect(doc.candidates).toHaveLength(0);
    expect(doc.warnings.length + doc.errors.length).toBeGreaterThan(0);
  });

  it("texte très long : tronqué pour le fournisseur avec warning (limite raisonnable)", async () => {
    const longDoc = "mot ".repeat(30000);
    const doc = await run("md", enc(longDoc), fakeProvider(VALID_OUTPUT));
    expect(doc.status).toBe("SUCCESS");
    expect(doc.warnings.some((w) => w.code === "TEXT_CHUNKED")).toBe(true);
  });

  it("fichier > 25 Mo refusé avant toute extraction", async () => {
    const big = new Uint8Array(25 * 1024 * 1024 + 1);
    const doc = await run("md", big);
    expect(doc.status).toBe("FAILED");
    expect(doc.errors[0]?.message).toMatch(/25 Mo/);
  });
});

// ---------------------------------------------------------------------------
// Statuts SUCCESS / PARTIAL / FAILED
// ---------------------------------------------------------------------------

describe("statuts d'extraction", () => {
  it("SUCCESS : texte extrait et candidats validés", async () => {
    const doc = await run("md", enc("Huile"), fakeProvider(VALID_OUTPUT));
    expect(doc.status).toBe("SUCCESS");
  });

  it("PARTIAL : texte extrait mais structuration refusée", async () => {
    const doc = await run("md", enc("texte brut présent"), fakeProvider({ candidates: "pas-un-tableau" }));
    expect(doc.status).toBe("PARTIAL");
    expect(doc.candidates).toHaveLength(0);
    expect(doc.pages[0].text).toContain("texte brut présent");
    expect(doc.warnings.length).toBeGreaterThan(0);
  });

  it("FAILED : aucun contenu exploitable", async () => {
    const doc = await run("md", new Uint8Array(0));
    expect(doc.status).toBe("FAILED");
  });
});

// ---------------------------------------------------------------------------
// 13. Décompression — limite documentaire anti zip-bomb
// ---------------------------------------------------------------------------

describe("décompression (anti zip-bomb)", () => {
  it("PDF : un flux dont la sortie dépasse MAX_DECOMPRESSED_BYTES est bloqué", async () => {
    const bomb = "A".repeat(MAX_DECOMPRESSED_BYTES + 1024);
    const doc = await run("pdf", makePdfBytes([bomb], true));
    expect(doc.status).toBe("FAILED");
    expect(doc.errors[0]?.code).toBe("DECOMPRESSION_LIMIT_EXCEEDED");
    expect(doc.pages).toHaveLength(0);
  });

  it("DOCX : word/document.xml dont la sortie dépasse la limite est bloqué", async () => {
    const bomb = "B".repeat(MAX_DECOMPRESSED_BYTES + 1024);
    const doc = await run("docx", makeDocxBytes([bomb], true));
    expect(doc.status).toBe("FAILED");
    expect(doc.errors[0]?.code).toBe("DECOMPRESSION_LIMIT_EXCEEDED");
    expect(doc.pages).toHaveLength(0);
  });

  it("PDF : plusieurs flux ne peuvent pas dépasser le budget global en cumulant", async () => {
    // 9 flux × 4 MiB = 36 MiB > 32 MiB : chaque flux seul passe sous la
    // limite, seule la somme est bloquée → le budget est bien global.
    // (4 MiB par flux : sous la limite de pile du regex de décodage.)
    const chunk = "C".repeat(4 * 1024 * 1024);
    const doc = await run("pdf", makePdfBytes(Array.from({ length: 9 }, () => chunk), true));
    expect(doc.status).toBe("FAILED");
    expect(doc.errors[0]?.code).toBe("DECOMPRESSION_LIMIT_EXCEEDED");
  });
});

// ---------------------------------------------------------------------------
// Helpers fixtures — PDF minimal 2+ pages, DOCX minimal (ZIP store)
// ---------------------------------------------------------------------------

function makePdfInlineUnicodeBytes(): Uint8Array {
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [5 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 4 0 R >> endobj",
    [
      "4 0 obj << /Length 0 >> stream",
      "/CIDInit /ProcSet findresource begin",
      "12 dict begin",
      "begincmap",
      "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
      "begincodespacerange",
      "<00> <FF>",
      "endcodespacerange",
      "beginbfchar",
      "<01> <0050>",
      "<02> <00E9>",
      "<03> <0072>",
      "<04> <006F>",
      "endbfchar",
      "endcmap",
      "CMapName currentdict /CMap defineresource pop",
      "end",
      "end",
      "endstream endobj",
    ].join("\n"),
    "5 0 obj << /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /Contents 6 0 R >> endobj",
    "6 0 obj << /Length 0 >> stream\nBT /F1 12 Tf <01020304> Tj ET\nendstream endobj",
  ];

  return new Uint8Array(Buffer.from("%PDF-1.4\n" + objects.map((obj) => obj + "\n").join(""), "latin1"));
}

function makePdfBytes(pages: string[], compress = false): Uint8Array {
  const enc = (s: string) => Buffer.from(s, "latin1");
  const objects: string[] = [];
  const pageRefs = pages.map((_, i) => `${5 + i} 0 R`).join(" ");
  objects.push(`1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj`);
  objects.push(
    `2 0 obj << /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >> endobj`
  );
  objects.push(`3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`);
  objects.push(`4 0 obj << >> endobj`);
  pages.forEach((_, i) => {
    const contentObj = 5 + pages.length + i;
    objects.push(
      `${5 + i} 0 obj << /Type /Page /Parent 2 0 R /Contents ${contentObj} 0 R >> endobj`
    );
  });
  pages.forEach((text, i) => {
    const contentObj = 5 + pages.length + i;
    const streamText = `BT /F1 12 Tf (Page ${i + 1} : ${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
    if (compress) {
      const deflated = deflateSync(Buffer.from(streamText, "latin1"));
      objects.push(
        `${contentObj} 0 obj << /Length ${deflated.length} /Filter /FlateDecode >> stream\n${deflated.toString(
          "latin1"
        )}\nendstream endobj`
      );
    } else {
      objects.push(
        `${contentObj} 0 obj << /Length ${streamText.length} >> stream\n${streamText}\nendstream endobj`
      );
    }
  });

  const body = "%PDF-1.4\n";
  const offsets: number[] = [];
  const encoder = (s: string) => enc(s);
  const parts: Buffer[] = [encoder(body)];
  let position = body.length;
  for (const obj of objects) {
    offsets.push(position);
    const chunk = `${obj}\n`;
    parts.push(encoder(chunk));
    position += chunk.length;
  }
  const xrefStart = position;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  parts.push(encoder(xref));
  return new Uint8Array(Buffer.concat(parts));
}

function makeDocxBytes(paragraphs: string[], deflate = false): Uint8Array {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
    .map((p) => `<w:p><w:r><w:t>${escapeXml(p)}</w:t></w:r></w:p>`)
    .join("")}</w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

  const files: Array<{ name: string; data: Buffer }> = [
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "word/document.xml", data: Buffer.from(documentXml, "utf8") },
  ];
  return new Uint8Array(buildZip(files, deflate ? 8 : 0));
}
function makeRichDocxBytes(deflate = false): Uint8Array {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t>Produit A</w:t></w:r><w:r><w:tab/><w:t>2500 FCFA</w:t></w:r><w:r><w:br/><w:t>Suite A</w:t></w:r></w:p>
<w:tbl>
<w:tr><w:tc><w:p><w:r><w:t>Produit</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Prix</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>Huile de palme 1L</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2500 FCFA</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
</w:body></w:document>`;
  const headerXml = `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>KAZA Catalogue</w:t></w:r></w:p></w:hdr>`;
  const footerXml = `<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Confidentiel</w:t></w:r></w:p></w:ftr>`;
  const footnotesXml = `<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1"><w:p><w:r><w:t>Prix hors taxe</w:t></w:r></w:p></w:footnote></w:footnotes>`;
  const files: Array<{ name: string; data: Buffer }> = [
    { name: "word/document.xml", data: Buffer.from(documentXml, "utf8") },
    { name: "word/header1.xml", data: Buffer.from(headerXml, "utf8") },
    { name: "word/footer1.xml", data: Buffer.from(footerXml, "utf8") },
    { name: "word/footnotes.xml", data: Buffer.from(footnotesXml, "utf8") },
    { name: "word/media/image1.bin", data: Buffer.alloc(1024 * 1024, 0xaa) },
  ];
  return new Uint8Array(buildZip(files, deflate ? 8 : 0));
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildZip(files: Array<{ name: string; data: Buffer }>, method: 0 | 8 = 0): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  const u16 = (n: number) => {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(n, 0);
    return b;
  };
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n, 0);
    return b;
  };

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, "utf8");
    const crc = crc32(file.data);
    const payload = method === 8 ? deflateRawSync(file.data) : file.data;
    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(payload.length),
      u32(file.data.length),
      u16(nameBuf.length),
      u16(0),
      nameBuf,
    ]);
    localParts.push(localHeader, payload);
    centralParts.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(method),
        u16(0),
        u16(0),
        u32(crc),
        u32(payload.length),
        u32(file.data.length),
        u16(nameBuf.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBuf,
      ])
    );
    offset += localHeader.length + payload.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...localParts, centralDir, eocd]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}