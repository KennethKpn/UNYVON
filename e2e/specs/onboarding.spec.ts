import crypto from "node:crypto";
import { test, type Page } from "@playwright/test";
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

/**
 * Parcours complet d'inscription → wizard (7 étapes) → dashboard avec un
 * compte FRAIS, audité et screenshotté étape par étape.
 *
 * Exception documentée (docs/PHASE_3K_REPORT.md) : exécuté sur
 * vp-390x844 uniquement — chaque run crée un compte éphémère, les captures
 * sont donc des artefacts locaux (test-results), jamais des baselines
 * versionnées. L'état « reprise wizard » sous la session principale est
 * couvert par audit.spec.ts + visual.spec.ts sur les 7 viewports.
 */
const WALK_VIEWPORT = "vp-390x844";

const PRIMARY_SELECTOR = [
  'button:has-text("Suivant")',
  'button:has-text("Enregistrer la vente")',
  'button:has-text("Accéder au dashboard")',
].join(", ");

async function auditStep(page: Page, heading: string): Promise<NewFinding[]> {
  const findings: NewFinding[] = [];
  const component = (label: string) => `[${heading}] ${label}`;

  const overflow = await checkGlobalOverflow(page);
  if (overflow.scrollWidth > overflow.viewportWidth + 1) {
    findings.push({
      kind: "overflow",
      component: component("document"),
      symptom: `scrollWidth ${overflow.scrollWidth}px > viewport ${overflow.viewportWidth}px`,
      detail: overflow.offenders.join(" | "),
      severity: "fail",
    });
  }

  for (const issue of await checkViewportContainment(page)) {
    findings.push({
      kind: "viewport",
      component: component(issue.component),
      symptom: issue.reason,
      detail: issue.rect,
      severity: "fail",
    });
  }

  for (const issue of await checkContrast(page)) {
    findings.push({
      kind: "contrast",
      component: component(issue.component),
      symptom: `ratio ${issue.ratio} < ${issue.required} (${issue.category})`,
      detail: issue.colors,
      severity: issue.category === "text-disabled" ? "info" : "fail",
    });
  }

  for (const issue of await checkTouchTargets(page)) {
    findings.push({
      kind: "touch",
      component: component(issue.component),
      symptom: `${issue.w}x${issue.h}px (< 44px)`,
      severity: "fail",
    });
  }

  for (const c of await checkUnnamedIconButtons(page)) {
    findings.push({
      kind: "aria",
      component: component(c),
      symptom: "bouton icône sans nom accessible",
      severity: "info",
    });
  }

  return findings;
}

test.describe("onboarding — parcours frais", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("inscription → 7 étapes → dashboard", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== WALK_VIEWPORT,
      `parcours complet audité sur ${WALK_VIEWPORT} uniquement (données éphémères)`
    );
    test.setTimeout(240_000);

    const findings: NewFinding[] = [];
    const email = `e2e.wizard.${Date.now()}.${crypto.randomBytes(3).toString("hex")}@test.dev`;
    const password = `E2e!${crypto.randomBytes(12).toString("base64url")}9`;

    /* --- Inscription --- */
    await page.goto("/signup");
    await page.fill('input[name="firstName"]', "E2E");
    await page.fill('input[name="lastName"]', "Wizard");
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(onboarding|dashboard)/, { timeout: 30_000 });

    /* --- Wizard --- */
    for (let i = 0; i < 12; i++) {
      if (page.url().includes("/dashboard")) break;

      const primary = page.locator(PRIMARY_SELECTOR);
      await primary.first().waitFor({ state: "visible", timeout: 20_000 });
      await page.locator("h2").first().waitFor({ state: "visible", timeout: 20_000 });
      const heading = (await page.locator("h2").first().innerText()).trim();

      if (heading.includes("Entreprise")) {
        const orgInput = page.locator('input[type="text"]').first();
        if ((await orgInput.inputValue()) === "") {
          await orgInput.fill("E2E Wizard Org");
        }
      } else if (heading.includes("Produits")) {
        const ex = page.locator('button:has-text("Ajouter des exemples agro")');
        if (await ex.isVisible().catch(() => false)) await ex.click();
      } else if (heading.includes("Clients")) {
        const ex = page.locator('button:has-text("Ajouter des exemples de clients")');
        if (await ex.isVisible().catch(() => false)) await ex.click();
      } else if (heading.includes("Première vente")) {
        const qty = page.locator('input[aria-label^="Quantité pour"]').first();
        await qty.fill("2");
      }

      findings.push(...(await auditStep(page, heading)));
      await page.screenshot({
        path: testInfo.outputPath(`wizard-step-${i + 1}-${heading}.png`),
      });

      await primary.first().click();
      await page
        .waitForFunction(
          (prev) => {
            const el = document.querySelector("h2");
            return !el || el.innerText.trim() !== prev;
          },
          heading,
          { timeout: 20_000 }
        )
        .catch(() => undefined);
    }

    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await settleRoute(page, "/dashboard");
    findings.push(...(await auditStep(page, "Dashboard")));

    recordFindings(testInfo, "/onboarding", findings);
    const fails = findings.filter((f) => f.severity === "fail");
    assertClean(
      fails.slice(0, 12),
      `/onboarding (parcours frais) — ${fails.length} échec(s)`,
      (f) => `[${f.kind}] ${f.component} → ${f.symptom}${f.detail ? ` (${f.detail})` : ""}`
    );
  });
});
