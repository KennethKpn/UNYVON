import { test, type Page } from "@playwright/test";
import {
  assertClean,
  recordFindings,
  settleRoute,
  type Finding,
} from "../helpers";

type NewFinding = Omit<Finding, "route">;

/**
 * P0 — mécanique de défilement des tables : toute table plus large que le
 * viewport doit être contournée par un conteneur overflow-x réellement
 * scrollable, contenu lui-même dans le viewport (pas de débordement global).
 */
const TABLE_ROUTES = [
  "/products",
  "/sales",
  "/expenses",
  "/purchases",
  "/suppliers",
  "/team",
];

interface TableReport {
  idx: number;
  heading: string;
  widerThanViewport: boolean;
  hasScroller: boolean;
  scrollable: boolean | null;
  scrolled: boolean | null;
  scrollerInViewport: boolean | null;
}

async function inspectTables(page: Page): Promise<TableReport[]> {
  return page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll<HTMLTableElement>("table"));
    return tables.map((t, idx) => {
      let p: HTMLElement | null = t.parentElement;
      let scroller: HTMLElement | null = null;
      while (p) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll") {
          scroller = p;
          break;
        }
        p = p.parentElement;
      }

      const rect = t.getBoundingClientRect();
      const vw = window.innerWidth;
      const widerThanViewport = rect.width > vw + 1;

      let scrollable: boolean | null = null;
      let scrolled: boolean | null = null;
      let scrollerInViewport: boolean | null = null;

      if (scroller) {
        scrollable = scroller.scrollWidth > scroller.clientWidth + 1;
        if (scrollable) {
          const before = scroller.scrollLeft;
          scroller.scrollLeft = 120;
          scrolled = scroller.scrollLeft > before;
          scroller.scrollLeft = before;
        }
        const cr = scroller.getBoundingClientRect();
        scrollerInViewport = cr.left >= -1 && cr.right <= vw + 1;
      }

      const heading = (
        t.querySelector("thead th")?.textContent || `table #${idx}`
      )
        .trim()
        .slice(0, 30);

      return {
        idx,
        heading,
        widerThanViewport,
        hasScroller: !!scroller,
        scrollable,
        scrolled,
        scrollerInViewport,
      };
    });
  });
}

for (const route of TABLE_ROUTES) {
  test(`${route} — tables & défilement horizontal`, async ({ page }, testInfo) => {
    const findings: NewFinding[] = [];
    await settleRoute(page, route);

    const tables = await inspectTables(page);
    if (tables.length === 0) {
      findings.push({
        kind: "overflow",
        component: route,
        symptom: "aucune table détectée (route sans tableau ?)",
        severity: "info",
      });
    }

    for (const t of tables) {
      const label = `table "${t.heading}"`;
      if (t.widerThanViewport && !t.hasScroller) {
        findings.push({
          kind: "overflow",
          component: label,
          symptom: "table plus large que le viewport sans conteneur overflow-x",
          severity: "fail",
        });
      } else if (t.widerThanViewport && t.scrollable && !t.scrolled) {
        findings.push({
          kind: "overflow",
          component: label,
          symptom: "conteneur scrollable mais le défilement ne bouge pas",
          severity: "fail",
        });
      } else if (t.scrollerInViewport === false) {
        findings.push({
          kind: "overflow",
          component: label,
          symptom: "conteneur de défilement hors viewport",
          severity: "fail",
        });
      }
    }

    recordFindings(testInfo, route, findings);
    const fails = findings.filter((f) => f.severity === "fail");
    assertClean(
      fails,
      `${route} — ${fails.length} échec(s)`,
      (f) => `[${f.kind}] ${f.component} → ${f.symptom}`
    );
  });
}
