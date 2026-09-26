import { test, expect } from "@playwright/test";
import {
  APP_ROUTES,
  CRITICAL_ROUTES,
  EXTREME_VIEWPORTS,
  PUBLIC_ROUTES,
  VIEWPORT_NAMES,
  type RouteDef,
  type ViewportName,
} from "../constants";
import { settleRoute } from "../helpers";

/**
 * Régression visuelle : baselines versionnées dans
 * e2e/screenshots/<viewport>/<route>.png (snapshotPathTemplate).
 * Critiques (8) × 7 viewports ; secondaires (9) × 2 extrêmes — exception
 * documentée dans docs/PHASE_3K_REPORT.md.
 * Captures au viewport (pas fullPage) : le contenu sous la ligne de flottaison
 * est couvert par les audits de layout 17 × 7.
 */
function viewportsFor(route: RouteDef): ViewportName[] {
  return CRITICAL_ROUTES.includes(route) ? VIEWPORT_NAMES : EXTREME_VIEWPORTS;
}

function registerVisual(route: RouteDef): void {
  for (const viewport of viewportsFor(route)) {
    test(`visuel ${route.name} @ ${viewport}`, async ({ page }, testInfo) => {
      test.skip(
        testInfo.project.name !== viewport,
        "hors matrice visuelle (routes secondaires : 2 extrêmes uniquement)"
      );
      // Marge pour la relance de navigation de settleRoute (shell absent /
      // redirection transitoire) + 2 tentatives de capture par expect().
      test.setTimeout(300_000);

      const settled = await settleRoute(page, route.path);
      expect(
        settled.ok,
        `page instable : ${settled.reason ?? "?"} (url ${page.url()}) — screenshot refusé (${route.path})`
      ).toBe(true);
      // Stabilisation des graphes (recharts) et du contenu asynchrone.
      await page.waitForTimeout(700);

      await expect(page).toHaveScreenshot(`${route.name}.png`);
    });
  }
}

test.describe("visuel — routes publiques", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const route of PUBLIC_ROUTES) registerVisual(route);
});

test.describe("visuel — routes applicatives", () => {
  for (const route of APP_ROUTES) registerVisual(route);
});
