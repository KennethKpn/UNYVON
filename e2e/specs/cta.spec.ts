import { test, type Page, type TestInfo } from "@playwright/test";
import { MOBILE_VIEWPORTS, type ViewportName } from "../constants";
import {
  assertClean,
  recordFindings,
  settleRoute,
  type Finding,
} from "../helpers";

type NewFinding = Omit<Finding, "route">;

interface CtaCase {
  route: string;
  name: string;
  selector: string;
}

/**
 * P0 — CTA primaires : visibles, atteints, actifs, non recouverts, et
 * (viewports tactiles) ≥ 44×44px. Les CTA masquées par le responsive
 * (menu hamburger) sont enregistrées en observation "info".
 */
const PUBLIC_CTA_CASES: CtaCase[] = [
  {
    route: "/",
    name: "hero — Commencer gratuitement",
    selector: 'section a[href="/signup"]:has-text("Commencer gratuitement")',
  },
  {
    route: "/",
    name: "nav — Essai gratuit",
    selector: 'nav a[href="/signup"]:has-text("Essai gratuit")',
  },
  { route: "/login", name: "submit — Se connecter", selector: 'button[type="submit"]' },
  { route: "/signup", name: "submit — Créer mon compte", selector: 'button[type="submit"]' },
];

const APP_CTA_CASES: CtaCase[] = [
  { route: "/products", name: "Ajouter un produit", selector: 'button:has-text("Ajouter un produit")' },
  { route: "/sales", name: "Nouvelle vente", selector: 'button:has-text("Nouvelle vente")' },
  { route: "/customers", name: "Ajouter un client", selector: 'button:has-text("Ajouter un client")' },
  { route: "/expenses", name: "Nouvelle dépense", selector: 'button:has-text("Nouvelle dépense")' },
];

async function checkCta(
  page: Page,
  cta: CtaCase,
  mobile: boolean
): Promise<NewFinding[]> {
  const findings: NewFinding[] = [];
  await settleRoute(page, cta.route);

  const target = page.locator(cta.selector).filter({ visible: true }).first();
  if (!(await target.isVisible().catch(() => false))) {
    findings.push({
      kind: "cta",
      component: cta.name,
      symptom: "CTA invisible sur ce viewport",
      severity: "info",
    });
    return findings;
  }

  if (!(await target.isEnabled())) {
    findings.push({
      kind: "cta",
      component: cta.name,
      symptom: "CTA désactivée",
      severity: "fail",
    });
  }

  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) return findings;

  const geo = await target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cx = Math.min(Math.max(r.left + r.width / 2, 1), Math.max(vw - 2, 1));
    const cy = Math.min(Math.max(r.top + r.height / 2, 1), Math.max(vh - 2, 1));
    const hit = document.elementFromPoint(cx, cy);
    const covered =
      !!hit && hit !== el && !el.contains(hit) && !hit.contains(el);
    return {
      left: r.left,
      right: r.right,
      vw,
      covered,
      coverTag: covered ? (hit as Element).tagName.toLowerCase() : "",
    };
  });

  if (geo.left < -1 || geo.right > geo.vw + 1) {
    findings.push({
      kind: "cta",
      component: cta.name,
      symptom: "CTA coupée horizontalement",
      detail: `${Math.round(geo.left)}→${Math.round(geo.right)} (vw=${geo.vw})`,
      severity: "fail",
    });
  }

  if (geo.covered) {
    findings.push({
      kind: "cta",
      component: cta.name,
      symptom: `CTA recouverte par <${geo.coverTag}>`,
      severity: "fail",
    });
  }

  if (mobile && (box.width < 44 || box.height < 44)) {
    findings.push({
      kind: "cta",
      component: cta.name,
      symptom: `zone tactile ${Math.round(box.width)}x${Math.round(box.height)}px (< 44px)`,
      severity: "fail",
    });
  }

  return findings;
}

function finish(
  testInfo: TestInfo,
  cta: CtaCase,
  findings: NewFinding[]
): void {
  recordFindings(testInfo, cta.route, findings);
  const fails = findings.filter((f) => f.severity === "fail");
  assertClean(
    fails.slice(0, 8),
    `${cta.route} — ${cta.name} — ${fails.length} échec(s)`,
    (f) => `[${f.kind}] ${f.symptom}${f.detail ? ` (${f.detail})` : ""}`
  );
}

function runCases(cases: CtaCase[]): void {
  for (const cta of cases) {
    test(`${cta.route} — ${cta.name}`, async ({ page }, testInfo) => {
      const mobile = MOBILE_VIEWPORTS.includes(
        testInfo.project.name as ViewportName
      );
      finish(testInfo, cta, await checkCta(page, cta, mobile));
    });
  }
}

test.describe("cta — public", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  runCases(PUBLIC_CTA_CASES);
});

test.describe("cta — applicatif", () => {
  runCases(APP_CTA_CASES);
});
