import { test, type Page, type TestInfo } from "@playwright/test";
import {
  APP_ROUTES,
  MOBILE_VIEWPORTS,
  PUBLIC_ROUTES,
  type RouteDef,
  type ViewportName,
} from "../constants";
import {
  assertClean,
  checkContrast,
  checkGlobalOverflow,
  checkTouchTargets,
  checkTypography,
  checkUnnamedIconButtons,
  checkViewportContainment,
  recordFindings,
  settleRoute,
  type Finding,
} from "../helpers";

type NewFinding = Omit<Finding, "route">;

/**
 * Audit layout/accessibilité : 17 routes × 7 viewports, 2 groupes
 * d'authentification (public sans cookies, applicatif avec la session
 * principale). Tous les findings sont enregistrés AVANT l'assertion finale
 * pour que artifacts/findings.jsonl soit complet même si le test échoue.
 */
async function auditRoute(
  page: Page,
  route: RouteDef,
  project: string
): Promise<NewFinding[]> {
  const findings: NewFinding[] = [];

  const settled = await settleRoute(page, route.path);

  // P0 — redirection inattendue (session absente / middleware défaillant).
  const pathname = new URL(page.url()).pathname;
  if (pathname !== route.path) {
    findings.push({
      kind: "redirect",
      component: "navigation",
      symptom: `route redirigée vers ${pathname}`,
      detail: `attendu ${route.path}`,
      severity: "fail",
    });
  } else if (!settled.ok) {
    // La redirection est déjà un finding ci-dessus : on ne double pas.
    findings.push({
      kind: "loading",
      component: "chargement",
      symptom: "page non stabilisée après relance (état de chargement ou d'erreur)",
      detail: settled.reason,
      severity: "info",
    });
  }

  // P0 — overflow horizontal global.
  const overflow = await checkGlobalOverflow(page);
  if (overflow.scrollWidth > overflow.viewportWidth + 1) {
    findings.push({
      kind: "overflow",
      component: "document",
      symptom: `scrollWidth ${overflow.scrollWidth}px > viewport ${overflow.viewportWidth}px`,
      detail: overflow.offenders.join(" | "),
      severity: "fail",
    });
  }

  // P0 — éléments coupés / recouverts.
  for (const issue of await checkViewportContainment(page)) {
    findings.push({
      kind: "viewport",
      component: issue.component,
      symptom: issue.reason,
      detail: issue.rect,
      severity: "fail",
    });
  }

  // P1 — contraste par catégorie (text-disabled = observation).
  for (const issue of await checkContrast(page)) {
    findings.push({
      kind: "contrast",
      component: issue.component,
      symptom: `ratio ${issue.ratio} < ${issue.required} (${issue.category})`,
      detail: issue.colors,
      severity: issue.category === "text-disabled" ? "info" : "fail",
    });
  }

  // P1 — cibles tactiles (viewports mobiles uniquement).
  if (MOBILE_VIEWPORTS.includes(project as ViewportName)) {
    for (const issue of await checkTouchTargets(page)) {
      findings.push({
        kind: "touch",
        component: issue.component,
        symptom: `${issue.w}x${issue.h}px (< 44px)`,
        severity: "fail",
      });
    }
  }

  // P2 — typographie < 12px.
  for (const issue of await checkTypography(page)) {
    findings.push({
      kind: "typography",
      component: issue.component,
      symptom: `texte ${issue.size} (< 12px)`,
      severity: "fail",
    });
  }

  // Observation hors scope P0/P1 — boutons icône sans nom accessible.
  for (const component of await checkUnnamedIconButtons(page)) {
    findings.push({
      kind: "aria",
      component,
      symptom: "bouton icône sans nom accessible",
      severity: "info",
    });
  }

  return findings;
}

function finish(
  testInfo: TestInfo,
  route: RouteDef,
  findings: NewFinding[]
): void {
  recordFindings(testInfo, route.path, findings);
  const fails = findings.filter((f) => f.severity === "fail");
  assertClean(
    fails.slice(0, 12),
    `${route.path} — ${fails.length} échec(s)`,
    (f) => `[${f.kind}] ${f.component} → ${f.symptom}${f.detail ? ` (${f.detail})` : ""}`
  );
}

test.describe("audit — routes publiques", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const route of PUBLIC_ROUTES) {
    test(`${route.name} (${route.path})`, async ({ page }, testInfo) => {
      finish(testInfo, route, await auditRoute(page, route, testInfo.project.name));
    });
  }
});

test.describe("audit — routes applicatives", () => {
  for (const route of APP_ROUTES) {
    test(`${route.name} (${route.path})`, async ({ page }, testInfo) => {
      finish(testInfo, route, await auditRoute(page, route, testInfo.project.name));
    });
  }
});
