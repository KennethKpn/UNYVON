// Chargement minimal de .env.local pour les scripts test-*.js du root.
// Aucune clé en dur ici : les secrets viennent exclusivement de l'environnement.
const fs = require("fs");
const path = require("path");

function loadEnv(file = ".env.local") {
  const p = path.join(__dirname, file);
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

module.exports = { loadEnv };
