// Constantes partagées config Playwright + specs (Phase 3K).

export const VIEWPORTS = {
  "vp-360x800": { width: 360, height: 800 },
  "vp-390x844": { width: 390, height: 844 },
  "vp-412x915": { width: 412, height: 915 },
  "vp-768x1024": { width: 768, height: 1024 },
  "vp-1024x768": { width: 1024, height: 768 },
  "vp-1366x768": { width: 1366, height: 768 },
  "vp-1920x1080": { width: 1920, height: 1080 },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;

export const MOBILE_VIEWPORTS: ViewportName[] = [
  "vp-360x800",
  "vp-390x844",
  "vp-412x915",
];

/** 17 routes auditées (contrainte 4). `auth: false` = routes publiques. */
export interface RouteDef {
  path: string;
  name: string;
  auth: boolean;
}

export const ROUTES: RouteDef[] = [
  { path: "/", name: "landing", auth: false },
  { path: "/login", name: "login", auth: false },
  { path: "/signup", name: "signup", auth: false },
  // Wizard reprend l'état persisté côté serveur : sans session, la page affiche
  // uniquement un état d'erreur → audité avec la session principale (étape 7).
  { path: "/onboarding", name: "onboarding", auth: true },
  { path: "/dashboard", name: "dashboard", auth: true },
  { path: "/products", name: "products", auth: true },
  { path: "/categories", name: "categories", auth: true },
  { path: "/inventory", name: "inventory", auth: true },
  { path: "/purchases", name: "purchases", auth: true },
  { path: "/suppliers", name: "suppliers", auth: true },
  { path: "/customers", name: "customers", auth: true },
  { path: "/sales", name: "sales", auth: true },
  { path: "/expenses", name: "expenses", auth: true },
  { path: "/import", name: "import", auth: true },
  { path: "/insights", name: "insights", auth: true },
  { path: "/team", name: "team", auth: true },
  { path: "/settings", name: "settings", auth: true },
  { path: "/billing", name: "billing", auth: true },
];

/**
 * Screenshots visuels : routes utilisateur critiques sur les 7 viewports.
 * Les 9 routes restantes (categories, inventory, purchases, suppliers,
 * expenses, insights, team, settings, billing) sont couvertes par les tests
 * layout (17 × 7) et screenshotées uniquement aux extrêmes mobile/desktop —
 * exception documentée dans docs/PHASE_3K_REPORT.md.
 */
export const CRITICAL_ROUTES: RouteDef[] = ROUTES.filter((r) =>
  [
    "/",
    "/login",
    "/signup",
    "/onboarding",
    "/dashboard",
    "/products",
    "/sales",
    "/customers",
    "/import",
  ].includes(r.path)
);

/** Routes secondaires : captures aux 2 extrêmes uniquement. */
export const SECONDARY_ROUTES: RouteDef[] = ROUTES.filter(
  (r) => !CRITICAL_ROUTES.includes(r)
);

export const EXTREME_VIEWPORTS: ViewportName[] = ["vp-360x800", "vp-1920x1080"];

export const VIEWPORT_NAMES: ViewportName[] = Object.keys(VIEWPORTS) as ViewportName[];

/**
 * Groupes d'authentification : le groupe public est audité SANS cookies
 * (état vide) pour refléter un vrai visiteur ; le groupe applicatif utilise la
 * session principale provisionnée par global-setup.
 */
const PUBLIC_PATHS = ["/", "/login", "/signup"];

export const PUBLIC_ROUTES: RouteDef[] = ROUTES.filter((r) =>
  PUBLIC_PATHS.includes(r.path)
);

export const APP_ROUTES: RouteDef[] = ROUTES.filter(
  (r) => !PUBLIC_PATHS.includes(r.path)
);
