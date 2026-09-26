import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Rapports/résultats Playwright (assets minifiés générés)
    "playwright-report/**",
    "test-results/**",
    "e2e/artifacts/**",
    // Scripts d'essai ponctuels du root (require Node, non lintés)
    "test-*.js",
  ]),
]);

export default eslintConfig;
