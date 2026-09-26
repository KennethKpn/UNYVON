import { defineConfig } from "@playwright/test";

// 7 viewports cibles (Phase 3K) — les specs de layout couvrent 17 routes × 7 viewports.
export const VIEWPORTS = {
  "vp-360x800": { width: 360, height: 800 },
  "vp-390x844": { width: 390, height: 844 },
  "vp-412x915": { width: 412, height: 915 },
  "vp-768x1024": { width: 768, height: 1024 },
  "vp-1024x768": { width: 1024, height: 768 },
  "vp-1366x768": { width: 1366, height: 768 },
  "vp-1920x1080": { width: 1920, height: 1080 },
} as const;

export const MOBILE_VIEWPORTS = [
  "vp-360x800",
  "vp-390x844",
  "vp-412x915",
] as const;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 3,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Marge pour settleRoute (relance unique + attentes empilées : goto, shell,
  // réseau, spinner) sur serveur froid — le chemin nominal reste ~20-70 s.
  timeout: 180_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      // Tolérance anti-bruit de rendu (anti-aliasing), pas une tolérance de layout.
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  // Screenshots de baseline versionnés : e2e/screenshots/<projet>/<nom>.png
  snapshotPathTemplate: "{testDir}/screenshots/{projectName}/{arg}{ext}",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3000",
    storageState: ".auth/state.json",
    locale: "fr-FR",
    timezoneId: "Africa/Porto-Novo",
    colorScheme: "light",
    // `reducedMotion` n'est pas exposé directement dans `use` : via
    // contextOptions (fusionné avec les options explicites ci-dessus).
    contextOptions: { reducedMotion: "reduce" },
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Contrainte 3 : toute baseline est générée depuis un build de production
  // neuf (jamais un serveur dev existant éventuellement obsolète).
  // reuseExistingServer: false → Playwright refuse de réutiliser un serveur
  // déjà en écoute sur :3000.
  webServer: {
    command: "npm run e2e:serve",
    url: "http://localhost:3000",
    // E2E_REUSE_SERVER=1 : itération rapide sur un serveur déjà relancé à la
    // main. Les runs de baseline/vérification finale ne définissent PAS cette
    // variable → build de production neuf systématiquement (contrainte 3).
    reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
    timeout: 300_000,
  },
  projects: Object.entries(VIEWPORTS).map(([name, viewport]) => ({
    name,
    use: { viewport },
  })),
});
