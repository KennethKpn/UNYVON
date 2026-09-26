import { test, expect, type Locator, type Page } from "@playwright/test";
import { MOBILE_VIEWPORTS, type ViewportName } from "../constants";
import {
  assertClean,
  checkContrast,
  checkGlobalOverflow,
  checkTouchTargets,
  checkUnnamedIconButtons,
  checkViewportContainment,
  recordFindings,
  settleRoute,
  type Finding,
} from "../helpers";

type NewFinding = Omit<Finding, "route">;

/** Screenshots de baseline réservés aux 2 viewports de référence. */
const SHOT_VIEWPORTS: ViewportName[] = ["vp-360x800", "vp-1024x768"];

interface ModalCase {
  route: string;
  name: string;
  openSelector: string;
  dialogLabel: string;
  shot: string;
}

const MODAL_CASES: ModalCase[] = [
  {
    route: "/products",
    name: "nouveau produit",
    openSelector: 'button:has-text("Ajouter un produit")',
    dialogLabel: "Ajouter un produit",
    shot: "modal-products",
  },
  {
    route: "/sales",
    name: "nouvelle vente",
    openSelector: 'button:has-text("Nouvelle vente")',
    dialogLabel: "Nouvelle vente",
    shot: "modal-sales",
  },
];

async function auditOpenDialog(
  page: Page,
  route: string,
  project: string
): Promise<NewFinding[]> {
  const findings: NewFinding[] = [];

  const overflow = await checkGlobalOverflow(page);
  if (overflow.scrollWidth > overflow.viewportWidth + 1) {
    findings.push({
      kind: "overflow",
      component: `${route} (dialog ouvert)`,
      symptom: `scrollWidth ${overflow.scrollWidth}px > viewport ${overflow.viewportWidth}px`,
      detail: overflow.offenders.join(" | "),
      severity: "fail",
    });
  }

  for (const issue of await checkViewportContainment(page)) {
    findings.push({
      kind: "viewport",
      component: issue.component,
      symptom: issue.reason,
      detail: issue.rect,
      severity: "fail",
    });
  }

  for (const issue of await checkContrast(page)) {
    findings.push({
      kind: "contrast",
      component: issue.component,
      symptom: `ratio ${issue.ratio} < ${issue.required} (${issue.category})`,
      detail: issue.colors,
      severity: issue.category === "text-disabled" ? "info" : "fail",
    });
  }

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

  for (const component of await checkUnnamedIconButtons(page, '[role="dialog"]')) {
    findings.push({
      kind: "aria",
      component,
      symptom: "bouton du dialog sans nom accessible",
      severity: "info",
    });
  }

  return findings;
}

async function closeDialog(page: Page, dialog: Locator): Promise<void> {
  const byLabel = dialog.locator('button[aria-label="Fermer"]').first();
  const close =
    (await byLabel.count()) > 0
      ? byLabel
      : dialog.locator("button").filter({ has: page.locator("svg.lucide-x") }).first();
  await close.click();
  await expect(dialog).toHaveCount(0);
}

for (const c of MODAL_CASES) {
  test(`${c.route} — dialog « ${c.name} »`, async ({ page }, testInfo) => {
    await settleRoute(page, c.route);
    await page.locator(c.openSelector).first().click();

    const dialog = page.locator(`[role="dialog"][aria-label="${c.dialogLabel}"]`);
    await expect(dialog).toBeVisible();

    const findings = await auditOpenDialog(page, c.route, testInfo.project.name);

    if (SHOT_VIEWPORTS.includes(testInfo.project.name as ViewportName)) {
      await expect(dialog).toHaveScreenshot(`${c.shot}.png`);
    }

    await closeDialog(page, dialog);

    recordFindings(testInfo, c.route, findings);
    const fails = findings.filter((f) => f.severity === "fail");
    assertClean(
      fails.slice(0, 12),
      `${c.route} (« ${c.name} ») — ${fails.length} échec(s)`,
      (f) => `[${f.kind}] ${f.component} → ${f.symptom}${f.detail ? ` (${f.detail})` : ""}`
    );
  });
}

test("sales — dialog « enregistrer un paiement »", async ({ page }, testInfo) => {
  await settleRoute(page, "/sales");

  const payButton = page.locator("button:has(svg.lucide-credit-card)").first();
  test.skip(
    !(await payButton.isVisible().catch(() => false)),
    "aucune vente confirmée disponible pour ouvrir le paiement"
  );
  await payButton.click();

  const dialog = page.locator('[role="dialog"][aria-label="Enregistrer un paiement"]');
  await expect(dialog).toBeVisible();

  const findings = await auditOpenDialog(page, "/sales", testInfo.project.name);

  if (SHOT_VIEWPORTS.includes(testInfo.project.name as ViewportName)) {
    await expect(dialog).toHaveScreenshot("modal-payment.png");
  }

  await closeDialog(page, dialog);

  recordFindings(testInfo, "/sales", findings);
  const fails = findings.filter((f) => f.severity === "fail");
  assertClean(
    fails.slice(0, 12),
    `/sales (« paiement ») — ${fails.length} échec(s)`,
    (f) => `[${f.kind}] ${f.component} → ${f.symptom}${f.detail ? ` (${f.detail})` : ""}`
  );
});
