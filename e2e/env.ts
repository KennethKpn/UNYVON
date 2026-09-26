import fs from "node:fs";
import path from "node:path";

/**
 * Chargement minimal de .env.local pour Playwright (config + globalSetup).
 * Aucun secret en dur : tout vient de l'environnement.
 */
export function loadEnv(file = ".env.local"): void {
  const p = path.join(process.cwd(), file);
  if (!fs.existsSync(p)) return;
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
