import fs from "node:fs";
import path from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";

/* ------------------------------------------------------------------ */
/*  Collecte de findings (alimente docs/PHASE_3K_REPORT.md)            */
/* ------------------------------------------------------------------ */

export type FindingKind =
  | "overflow"
  | "viewport"
  | "contrast"
  | "touch"
  | "typography"
  | "cta"
  | "redirect"
  | "aria"
  | "loading";

export interface Finding {
  kind: FindingKind;
  route: string;
  component: string;
  symptom: string;
  detail?: string;
  severity: "fail" | "info";
}

const ARTIFACTS_DIR = path.join(process.cwd(), "e2e", "artifacts");

export function recordFindings(
  testInfo: TestInfo,
  route: string,
  findings: Omit<Finding, "route">[]
): Finding[] {
  if (findings.length === 0) return [];
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const line = findings.map((f) => ({ route, ...f }));
  fs.appendFileSync(
    path.join(ARTIFACTS_DIR, "findings.jsonl"),
    line.map((f) => JSON.stringify({ viewport: testInfo.project.name, ...f })).join("\n") + "\n"
  );
  return line;
}

export function summarize(findings: Finding[]): string {
  return findings
    .map((f) => `[${f.kind}] ${f.component} → ${f.symptom}${f.detail ? ` (${f.detail})` : ""}`)
    .join("\n");
}

/* ------------------------------------------------------------------ */
/*  Navigation robuste (fonts + réseau stabilisés)                     */
/* ------------------------------------------------------------------ */

export async function gotoRoute(page: Page, route: string): Promise<void> {
  // domcontentloaded plutôt que load : les sous-ressources tierces (polices,
  // tracking) ne doivent pas faire échouer la navigation — les attentes shell,
  // réseau calme et spinner de settleRoute garantissent la stabilité ensuite.
  await page.goto(route, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await Promise.race([
    page.evaluate(() => document.fonts.ready.then(() => undefined)),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
  await page.waitForTimeout(400);
}

export interface SettleResult {
  ok: boolean;
  /** Raison précise de l'instabilité (diagnostic pour l'assertion/le finding). */
  reason?: string;
}

/**
 * Navigation + attente de stabilité : le shell applicatif n'affiche
 * #main-content qu'après chargement de l'organisation, et chaque page fetch
 * ses données (Supabase) après le premier rendu — on attend donc le réseau
 * calme PLUS la disparition des états « Chargement… » / spinners hors bouton
 * pour ne jamais auditer/screenshotter un état de chargement.
 * Relance UNE fois la navigation si le shell n'apparaît pas (erreur serveur
 * transitoire) ou si la route a redirigé ailleurs (perte de session
 * intermittente sous charge). Si la page reste instable, ok=false avec la
 * raison : chaque spec décide entre enregistrer un finding ou échouer.
 */
export async function settleRoute(
  page: Page,
  route: string
): Promise<SettleResult> {
  const attempt = async (): Promise<{
    shell: boolean;
    url: string;
    diag?: Record<string, unknown>;
  }> => {
    // Navigation ratée (serveur momentanément saturé) : on la signale comme
    // shell absent, ce qui déclenche la relance unique plus bas.
    await gotoRoute(page, route).catch(() => undefined);
    // ANY explicite (et non waitForSelector) : sur /login mobile, h1 existe
    // mais fait 0×0 (panneau de marque masqué) et bloquait l'attente.
    const shell = await page
      .waitForFunction(
        () =>
          Array.from(
            document.querySelectorAll("#main-content, h1, h2")
          ).some((el) => {
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) return false;
            const st = getComputedStyle(el);
            return st.visibility !== "hidden" && st.display !== "none";
          }),
        undefined,
        { timeout: 15_000 }
      )
      .then(() => true)
      .catch(() => false);
    const url = new URL(page.url()).pathname;
    if (shell) return { shell, url };
    // Diagnostic : pourquoi le shell est-il absent ?
    const diag = await page
      .evaluate(() => {
        const info = (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return { exists: false };
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          return {
            exists: true,
            w: Math.round(r.width),
            h: Math.round(r.height),
            display: st.display,
            visibility: st.visibility,
            text: (el.textContent || "").slice(0, 40),
          };
        };
        return {
          path: location.pathname,
          readyState: document.readyState,
          h1: info("h1"),
          h2: info("h2"),
          main: info("#main-content"),
          bodyLen: document.body ? document.body.innerText.length : -1,
          snippet: document.body
            ? document.body.innerText.slice(0, 120).replace(/\s+/g, " ")
            : "",
        };
      })
      .catch((e) => ({ evalError: String(e) }));
    return { shell, url, diag };
  };

  let result = await attempt();
  if (!result.shell || result.url !== route) {
    result = await attempt();
  }

  await page
    .waitForLoadState("networkidle", { timeout: 15_000 })
    .catch(() => undefined);

  interface Probe {
    done: boolean;
    textHit: boolean;
    spinners: number;
  }
  const probe = await page
    .waitForFunction<Probe | null>(
      (): Probe | null => {
        const textHit = /chargement|loading/i.test(document.body.innerText);
        const spinners = Array.from(
          document.querySelectorAll("svg.animate-spin")
        ).filter((s) => !s.closest("button")).length;
        if (!textHit && spinners === 0) return { done: true, textHit, spinners };
        return null;
      },
      undefined,
      { timeout: 30_000 }
    )
    .then((handle): Promise<Probe> => handle.jsonValue() as Promise<Probe>)
    .catch(
      (): Promise<Probe> =>
        page.evaluate((): Probe => {
          const textHit = /chargement|loading/i.test(document.body.innerText);
          const spinners = Array.from(
            document.querySelectorAll("svg.animate-spin")
          ).filter((s) => !s.closest("button")).length;
          return { done: false, textHit, spinners };
        })
    );

  await page.waitForTimeout(400);

  const reasons: string[] = [];
  if (!result.shell) {
    reasons.push(
      `shell (h1/h2/#main-content) absent${result.diag ? ` ${JSON.stringify(result.diag)}` : ""}`
    );
  }
  if (result.url !== route) reasons.push(`redirigé vers ${result.url}`);
  if (!probe.done) {
    reasons.push(
      probe.textHit
        ? "texte « chargement/loading » persistant"
        : `spinners hors bouton: ${probe.spinners}`
    );
  }
  return { ok: reasons.length === 0, reason: reasons.join(" + ") || undefined };
}

/* ------------------------------------------------------------------ */
/*  P0 — Overflow horizontal global                                    */
/* ------------------------------------------------------------------ */

export interface OverflowResult {
  scrollWidth: number;
  viewportWidth: number;
  offenders: string[];
}

export async function checkGlobalOverflow(page: Page): Promise<OverflowResult> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const sw = Math.max(doc.scrollWidth, body ? body.scrollWidth : 0);
    const vw = window.innerWidth;
    const offenders: string[] = [];
    if (sw > vw + 1) {
      const all = Array.from(document.querySelectorAll<HTMLElement>("body *"));
      for (const el of all) {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        if (r.right <= vw + 1 && r.left >= -1) continue;
        const st = getComputedStyle(el);
        if (st.position === "fixed") continue;
        // Conteneur à défilement horizontal explicite = accepté.
        let p: HTMLElement | null = el.parentElement;
        let scrollable = false;
        while (p) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === "auto" || ox === "scroll") {
            scrollable = true;
            break;
          }
          p = p.parentElement;
        }
        if (scrollable) continue;
        const cls = (el.className || "").toString().slice(0, 80);
        offenders.push(
          `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${cls} [${Math.round(r.left)}→${Math.round(r.right)}]`
        );
        if (offenders.length >= 8) break;
      }
    }
    return { scrollWidth: sw, viewportWidth: vw, offenders };
  });
}

/* ------------------------------------------------------------------ */
/*  P0 — Éléments hors viewport / masqués / recouverts                 */
/* ------------------------------------------------------------------ */

export interface ViewportIssue {
  component: string;
  reason: "clipped-right" | "clipped-left" | "covered";
  rect: string;
}

export async function checkViewportContainment(
  page: Page
): Promise<ViewportIssue[]> {
  return page.evaluate(() => {
    const sel =
      'button, a[href], input:not([type="hidden"]), select, textarea, h1, h2, h3, table, [role="button"]';
    const vw = window.innerWidth;
    const out: ViewportIssue[] = [];

    const dialogOpen = Array.from(
      document.querySelectorAll('[role="dialog"]')
    ).some((d) => {
      const r = d.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });

    const inScrollable = (el: HTMLElement): boolean => {
      let p: HTMLElement | null = el.parentElement;
      while (p) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll") return true;
        p = p.parentElement;
      }
      return false;
    };

    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const st = getComputedStyle(el);
      if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) === 0)
        continue;
      if (el.closest('[aria-hidden="true"]')) continue;

      const label = `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} "${(el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 40)}"`;

      // Entièrement hors écran : menu fermé / drawer hors-canvas → ignoré.
      if (r.right <= 1 || r.left >= vw - 1) continue;

      // Partiellement coupé horizontalement (hors d'un conteneur scrollable).
      if ((r.right > vw + 1 || r.left < -1) && !inScrollable(el)) {
        out.push({
          component: label,
          reason: r.right > vw + 1 ? "clipped-right" : "clipped-left",
          rect: `${Math.round(r.left)}→${Math.round(r.right)} (vw=${vw})`,
        });
        continue;
      }

      // Recouvert par un autre élément (uniquement si aucun overlay actif).
      if (dialogOpen) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      const cx = Math.min(Math.max(r.left + r.width / 2, 1), vw - 2);
      const cy = Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 2);
      const hit = document.elementFromPoint(cx, cy);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
        const hitSt = getComputedStyle(hit);
        // Un fond de page/section opaque qui déborde n'est pas un masquage.
        if (hitSt.position !== "fixed" && hitSt.position !== "sticky") {
          const hitRect = hit.getBoundingClientRect();
          if (hitRect.width > r.width * 1.5 && hitRect.height > r.height * 1.5) {
            continue; // élément contenu dans un bloc plus grand : pas un masquage
          }
        }
        out.push({
          component: label,
          reason: "covered",
          rect: `couvert par ${hit.tagName.toLowerCase()}${(hit.className || "").toString().slice(0, 40)}`,
        });
      }
    }
    return out;
  });
}

/* ------------------------------------------------------------------ */
/*  P1 — Touch targets ≥ 44×44 (viewports tactiles)                    */
/* ------------------------------------------------------------------ */

export interface TouchIssue {
  component: string;
  w: number;
  h: number;
}

export async function checkTouchTargets(page: Page): Promise<TouchIssue[]> {
  return page.evaluate(() => {
    const sel =
      'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], summary';
    const out: TouchIssue[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0)
        continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      // Lien strictement en ligne dans un flux de texte : exception.
      if (el.tagName === "A" && st.display === "inline") continue;
      // Désactivés : non cliquables, non comptés.
      if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true")
        continue;
      if (el.offsetParent === null && st.position !== "fixed") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.right <= 0 || r.left >= window.innerWidth) continue; // drawer fermé
      // Entièrement au-dessus du viewport (ex. skip-link à top:-100%) :
      // non atteignable au doigt en l'état, hors périmètre.
      if (r.bottom <= 0) continue;
      if (r.width < 44 || r.height < 44) {
        out.push({
          component: `${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 40)}"`,
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }
    return out;
  });
}

/* ------------------------------------------------------------------ */
/*  P2 — Typographie < 12px                                            */
/* ------------------------------------------------------------------ */

export interface TypeIssue {
  component: string;
  size: string;
}

export async function checkTypography(page: Page): Promise<TypeIssue[]> {
  return page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const out: TypeIssue[] = [];
    const seen = new Set<string>();
    let node = walker.nextNode();
    while (node) {
      const text = (node.textContent || "").trim();
      const el = node.parentElement;
      if (el && text.length > 0 && !el.closest('[aria-hidden="true"]')) {
        const st = getComputedStyle(el);
        if (st.display !== "none" && st.visibility !== "hidden" && Number(st.opacity) > 0) {
          const size = parseFloat(st.fontSize);
          if (size > 0 && size < 12) {
            const key = `${el.tagName}.${el.className}|${size}`;
            if (!seen.has(key)) {
              seen.add(key);
              out.push({
                component: `${el.tagName.toLowerCase()} ${text.slice(0, 30)}`,
                size: `${size}px`,
              });
            }
          }
        }
      }
      node = walker.nextNode();
    }
    return out;
  });
}

/* ------------------------------------------------------------------ */
/*  P1 — Contraste catégorisé (contrainte 2 : bonnes catégories,       */
/*  peu de faux positifs)                                              */
/* ------------------------------------------------------------------ */

export type ContrastCategory =
  | "text-normal"
  | "text-large"
  | "text-disabled"
  | "control"
  | "placeholder"
  | "icon"
  | "decorative";

export interface ContrastIssue {
  component: string;
  category: ContrastCategory;
  ratio: number;
  required: number;
  colors: string;
}

export async function checkContrast(page: Page): Promise<ContrastIssue[]> {
  return page.evaluate(() => {
    const issues: ContrastIssue[] = [];
    const seen = new Set<string>();

    const parseColor = (
      c: string
    ): [number, number, number, number] | null => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1].split(",").map((x) => parseFloat(x.trim()));
      const r = parts[0];
      const g = parts[1];
      const b = parts[2];
      const a = parts.length > 3 ? parts[3] : 1;
      return [r, g, b, a];
    };

    const over = (
      src: [number, number, number, number],
      dst: [number, number, number, number]
    ): [number, number, number, number] => {
      const a = src[3] + dst[3] * (1 - src[3]);
      if (a === 0) return [0, 0, 0, 0];
      return [
        (src[0] * src[3] + dst[0] * dst[3] * (1 - src[3])) / a,
        (src[1] * src[3] + dst[1] * dst[3] * (1 - src[3])) / a,
        (src[2] * src[3] + dst[2] * dst[3] * (1 - src[3])) / a,
        a,
      ];
    };

    const lum = (rgb: [number, number, number]): number => {
      const f = (v: number) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
    };

    const ratio = (
      a: [number, number, number],
      b: [number, number, number]
    ): number => {
      const l1 = lum(a);
      const l2 = lum(b);
      const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
      return (hi + 0.05) / (lo + 0.05);
    };

    // Fond effectif : remonte la chaîne d'ancêtres. Image non dégradée →
    // non vérifiable (on saute, anti-faux-positif). Dégradés → on retient les
    // stops de couleur pour évaluire le pire contraste réel.
    type Bg =
      | { kind: "color"; color: [number, number, number, number] }
      | { kind: "gradient"; stops: string[] }
      | null;

    const gradientStops = (image: string): string[] | null => {
      if (!image.startsWith("linear-gradient") && !image.startsWith("radial-gradient"))
        return null;
      const matches = image.match(
        /rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}/g
      );
      return matches ?? null;
    };

    const effectiveBg = (el: HTMLElement): Bg => {
      const chain: HTMLElement[] = [];
      let cur: HTMLElement | null = el;
      while (cur) {
        const st = getComputedStyle(cur);
        if (st.mixBlendMode !== "normal" || st.backdropFilter !== "none") {
          return null;
        }
        if (st.backgroundImage !== "none") {
          const stops = gradientStops(st.backgroundImage);
          // Fond d'image non dégradé (photo, motif) → non vérifiable.
          if (!stops || stops.length === 0) return null;
          chain.push(cur);
          const solid = parseColor(st.backgroundColor);
          const base =
            solid && solid[3] > 0
              ? over(solid, [255, 255, 255, 1])
              : ([255, 255, 255, 1] as [number, number, number, number]);
          const composited = stops.map((s) => {
            const c = parseColor(s);
            return c
              ? `rgba(${Math.round(over(c, base)[0])},${Math.round(
                  over(c, base)[1]
                )},${Math.round(over(c, base)[2])},1)`
              : s;
          });
          cur = cur.parentElement;
          // On continue de remonter pour un éventuel autre dégradé parent,
          // mais le premier dégradé rencontré domine visuellement.
          return { kind: "gradient", stops: composited };
        }
        chain.push(cur);
        cur = cur.parentElement;
      }
      let acc: [number, number, number, number] = [0, 0, 0, 0];
      for (let i = chain.length - 1; i >= 0; i--) {
        const c = parseColor(getComputedStyle(chain[i]).backgroundColor);
        if (c && c[3] > 0) acc = over(c, acc);
      }
      return { kind: "color", color: acc };
    };

    const label = (el: HTMLElement): string =>
      `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} "${(el.textContent || "").trim().slice(0, 35)}" .${(el.className || "").toString().slice(0, 50)}`;

    const requiredFor = (
      category: ContrastCategory,
      fontSize: number,
      weight: number
    ): number => {
      if (category === "icon") return 3;
      if (category === "text-large" || (fontSize >= 18.66 && weight >= 700))
        return 3;
      if (fontSize >= 24) return 3;
      return 4.5;
    };

    const push = (
      el: HTMLElement,
      category: ContrastCategory,
      r: number,
      req: number,
      colors: string
    ) => {
      const key = `${category}|${label(el)}|${colors}`;
      if (seen.has(key)) return;
      seen.add(key);
      issues.push({
        component: label(el),
        category,
        ratio: Math.round(r * 100) / 100,
        required: req,
        colors,
      });
    };

    const checkFg = (
      el: HTMLElement,
      fgRaw: string,
      bg: Bg,
      category: ContrastCategory
    ) => {
      if (!bg) return;
      const fg = parseColor(fgRaw);
      if (!fg || fg[3] === 0) return; // texte transparent
      const st = getComputedStyle(el);
      const fontSize = parseFloat(st.fontSize);
      const weight = parseInt(st.fontWeight) || 400;
      const req = requiredFor(category, fontSize, weight);

      if (bg.kind === "color") {
        const bgRgb: [number, number, number, number] =
          bg.color[3] < 1
            ? over([255, 255, 255, 1], bg.color) // fond translucide sur blanc de page
            : bg.color;
        const composited = over(fg, bgRgb);
        const r = ratio(
          [composited[0], composited[1], composited[2]],
          [bgRgb[0], bgRgb[1], bgRgb[2]]
        );
        if (r + 0.005 < req) {
          push(
            el,
            category,
            r,
            req,
            `fg=${fgRaw} / bg=rgba(${Math.round(bgRgb[0])},${Math.round(
              bgRgb[1]
            )},${Math.round(bgRgb[2])},1)`
          );
        }
        return;
      }

      // Fond en dégradé : pire ratio parmi les stops (modèle conservateur).
      let worst = Infinity;
      let worstStop = "";
      for (const stop of bg.stops) {
        const c = parseColor(stop);
        if (!c) continue;
        const opaque: [number, number, number, number] = [c[0], c[1], c[2], 1];
        const composited = over(fg, opaque);
        const r = ratio(
          [composited[0], composited[1], composited[2]],
          [c[0], c[1], c[2]]
        );
        if (r < worst) {
          worst = r;
          worstStop = stop;
        }
      }
      if (worst !== Infinity && worst + 0.005 < req) {
        push(el, category, worst, req, `fg=${fgRaw} / pire stop ${worstStop}`);
      }
    };

    const isInteractive = (el: HTMLElement): boolean =>
      !!el.closest('button, a[href], [role="button"], input, select, textarea, label');

    const isDisabled = (el: HTMLElement): boolean =>
      !!(
        el.closest(":disabled") ||
        el.closest('[aria-disabled="true"]') ||
        (el.tagName === "BUTTON" && (el as HTMLButtonElement).disabled)
      );

    const categoryOf = (el: HTMLElement): ContrastCategory => {
      if (isDisabled(el)) return "text-disabled";
      if (isInteractive(el)) return "control";
      const st = getComputedStyle(el);
      const fontSize = parseFloat(st.fontSize);
      const weight = parseInt(st.fontWeight) || 400;
      if (fontSize >= 24 || (fontSize >= 18.66 && weight >= 700))
        return "text-large";
      return "text-normal";
    };

    /* --- 1. Nœuds texte directs --- */
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = (node.textContent || "").trim();
      const el = node.parentElement;
      if (el && text.length > 0) {
        const st = getComputedStyle(el);
        const visible =
          st.display !== "none" &&
          st.visibility !== "hidden" &&
          Number(st.opacity) > 0 &&
          !el.closest('[aria-hidden="true"]') &&
          !(el as HTMLElement).closest("[hidden]");
        if (visible) {
          const r = el.getBoundingClientRect();
          const tiny = r.width < 3 || r.height < 3;
          const clipText =
            (st as CSSStyleDeclaration & { webkitTextFillColor?: string })
              .webkitTextFillColor === "transparent";
          if (!tiny && !clipText && el.tagName !== "OPTION" && el.tagName !== "SCRIPT" && el.tagName !== "STYLE") {
            const bgInfo = effectiveBg(el);
            if (bgInfo) {
              checkFg(el, st.color, bgInfo, categoryOf(el));
            }
          }
        }
      }
      node = walker.nextNode();
    }

    /* --- 2. Placeholders (uniquement inputs vides : placeholder visible) --- */
    for (const el of Array.from(
      document.querySelectorAll<HTMLInputElement>("input[placeholder], textarea[placeholder]")
    )) {
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") continue;
      if (el.value !== "") continue; // placeholder masqué par la valeur
      const bgInfo = effectiveBg(el);
      if (!bgInfo) continue;
      const phColor = getComputedStyle(el, "::placeholder").color;
      checkFg(el, phColor, bgInfo, "placeholder");
    }

    /* --- 3. Icônes informatives (svg accessible, non décoratif) --- */
    for (const svg of Array.from(document.querySelectorAll<SVGElement>("svg"))) {
      if (svg.getAttribute("aria-hidden") === "true") continue;
      if (svg.closest('[aria-hidden="true"]')) continue;
      const hasName =
        svg.hasAttribute("aria-label") ||
        !!svg.querySelector("title") ||
        svg.getAttribute("role") === "img";
      if (!hasName) continue;
      const r = svg.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const bgInfo = effectiveBg(svg as unknown as HTMLElement);
      if (!bgInfo) continue;
      const color = getComputedStyle(svg).color;
      checkFg(svg as unknown as HTMLElement, color, bgInfo, "icon");
    }

    /* --- 4. Déduplication --- */
    return issues.filter(
      (i, idx, arr) =>
        arr.findIndex(
          (x) => x.component === i.component && x.category === i.category
        ) === idx
    );
  });
}

/* ------------------------------------------------------------------ */
/*  A11y — boutons icône sans nom accessible (observation, hors scope  */
/*  P0/P1 : sévérité "info")                                           */
/* ------------------------------------------------------------------ */

export async function checkUnnamedIconButtons(
  page: Page,
  root = "body"
): Promise<string[]> {
  return page.evaluate((rootSel) => {
    const scope = document.querySelector(rootSel) ?? document.body;
    const out: string[] = [];
    for (const el of Array.from(
      scope.querySelectorAll<HTMLElement>("button, [role='button']")
    )) {
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0)
        continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const name = `${el.getAttribute("aria-label") ?? ""}${el.innerText ?? ""}${el.getAttribute("title") ?? ""}`.trim();
      if (name === "") {
        out.push(
          `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} .${(el.className || "").toString().slice(0, 60)}`
        );
      }
    }
    return out;
  }, root);
}

/* ------------------------------------------------------------------ */
/*  Assertion utilitaire                                              */
/* ------------------------------------------------------------------ */

export function assertClean<T>(
  issues: T[],
  label: string,
  format: (i: T) => string
): void {
  expect(
    issues.map(format),
    `${label} — ${issues.length} problème(s):\n${issues.map(format).join("\n")}`
  ).toEqual([]);
}
