import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// 20-22. Sécurité — vérifications statiques sur les sources réelles
// ---------------------------------------------------------------------------

const SRC = path.join(process.cwd(), "src");
const EXTRACTION_DIR = path.join(SRC, "lib", "import", "extraction");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function read(file: string): string {
  return readFileSync(file, "utf8");
}

function isClientFile(source: string): boolean {
  return source.startsWith('"use client"') || source.startsWith("'use client'");
}

const allFiles = walk(SRC);
const clientFiles = allFiles.filter((f) => isClientFile(read(f)));
const extractionFiles = walk(EXTRACTION_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

describe("20. aucune écriture dans les tables métier", () => {
  it("le module d'extraction n'accède à aucune base de données", () => {
    for (const file of extractionFiles) {
      const source = read(file);
      expect(source, file).not.toMatch(/createServerSupabase|createClient|supabase\.from\(/);
      expect(source, file).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
      expect(source, file).not.toMatch(/inventory_movements|product-actions|category-actions|sales|purchases|payments/);
    }
  });

  it("aucun import du module d'extraction depuis un fichier 'use client'", () => {
    for (const file of clientFiles) {
      const source = read(file);
      expect(source, file).not.toMatch(/from ["'].*extraction/);
    }
  });
});

describe("21. aucun appel modèle côté navigateur", () => {
  it("aucun fichier 'use client' ne référence le fournisseur IA ou une clé", () => {
    for (const file of clientFiles) {
      const source = read(file);
      expect(source, file).not.toMatch(/GEMINI_API_KEY|OPENAI_API_KEY|generateContent|api\.openai\.com|generativelanguage/);
      expect(source, file).not.toMatch(/from ["'].*extraction\/provider/);
    }
  });

  it("le module provider d'extraction n'est jamais marqué 'use client'", () => {
    for (const file of extractionFiles) {
      expect(isClientFile(read(file)), file).toBe(false);
    }
  });
});

describe("22. aucune clé exposée au client", () => {
  it("aucune variable NEXT_PUBLIC_ hors des deux allowlistes Supabase publiques", () => {
    const ALLOWED = new Set(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
    for (const file of allFiles) {
      const source = read(file);
      const found = source.match(/NEXT_PUBLIC_[A-Z_]+/g) ?? [];
      const forbidden = found.filter((m) => !ALLOWED.has(m));
      expect(forbidden, file).toEqual([]);
    }
  });

  it("aucun service_role côté client", () => {
    for (const file of clientFiles) {
      const source = read(file);
      expect(source, file).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|service_role/);
    }
  });

  it("le module d'extraction ne journalise jamais de valeur d'environnement de clé", () => {
    for (const file of extractionFiles) {
      const source = read(file);
      expect(source, file).not.toMatch(/console\.(log|info|warn|error)\([^)]*(API_KEY|apiKey)/);
    }
  });
});
