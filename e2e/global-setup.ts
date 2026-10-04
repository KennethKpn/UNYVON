import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium, type Page } from "@playwright/test";
import { loadEnv } from "./env";

loadEnv();

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

function isLocalBaseUrl(): boolean {
  const hostname = new URL(BASE).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function assertTargetPolicy(): void {
  if (!isLocalBaseUrl() && process.env.E2E_ALLOW_REMOTE !== "1") {
    throw new Error(
      "E2E_BASE_URL distant détecté. Pour éviter tout lancement accidentel contre un environnement réel, définissez explicitement E2E_ALLOW_REMOTE=1."
    );
  }
}
const AUTH_DIR = ".auth";
const STATE_PATH = path.join(AUTH_DIR, "state.json");

function ensureCredentials(): { email: string; password: string } {
  let email = process.env.E2E_USER_EMAIL;
  let password = process.env.E2E_USER_PASSWORD;

  if ((email && !password) || (!email && password)) {
    throw new Error(
      "Configuration E2E incomplète : E2E_USER_EMAIL et E2E_USER_PASSWORD doivent être fournis ensemble."
    );
  }

  const allowAutoProvision = process.env.E2E_ALLOW_AUTO_PROVISION === "1";

  if (!email && !password) {
    if (!allowAutoProvision) {
      throw new Error(
        "Identifiants E2E absents. Fournissez E2E_USER_EMAIL + E2E_USER_PASSWORD, ou activez explicitement E2E_ALLOW_AUTO_PROVISION=1 uniquement sur un environnement de test dédié."
      );
    }

    email = `e2e.main.${crypto.randomBytes(4).toString("hex")}@test.dev`;
    password = `E2e!${crypto.randomBytes(12).toString("base64url")}9`;

    const envPath = path.join(process.cwd(), ".env.local");
    const existing = fs.existsSync(envPath)
      ? fs.readFileSync(envPath, "utf8")
      : "";
    const sep = existing && !existing.endsWith("\n") ? "\n" : "";
    const add: string[] = [];
    if (!existing.includes("E2E_USER_EMAIL=")) {
      add.push(`E2E_USER_EMAIL=${email}`);
    }
    if (!existing.includes("E2E_USER_PASSWORD=")) {
      add.push(`E2E_USER_PASSWORD=${password}`);
    }
    if (add.length > 0) {
      fs.appendFileSync(envPath, `${sep}${add.join("\n")}\n`);
    }
  }

  if (!email || !password) {
    throw new Error("Identifiants E2E introuvables après configuration.");
  }

  process.env.E2E_USER_EMAIL = email;
  process.env.E2E_USER_PASSWORD = password;
  return { email, password };
}

async function tryLogin(
  page: Page,
  email: string,
  password: string
): Promise<boolean> {
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  try {
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), {
      timeout: 15_000,
    });
    return true;
  } catch {
    return false;
  }
}

/** Parcours complet des 6 étapes d'onboarding. Le compte doit déjà exister. */
async function completeOnboarding(page: Page): Promise<void> {
  if (page.url().includes("/dashboard")) return;

  await page.waitForURL(/\/(onboarding|dashboard)/, { timeout: 30_000 });
  if (page.url().includes("/dashboard")) return;

  for (let i = 0; i < 12; i++) {
    if (page.url().includes("/dashboard")) break;

    const primary = page.locator(
      'button:text-is("Suivant"), button:text-is("Enregistrer la vente"), button:text-is("Accéder au dashboard")'
    );
    await primary.first().waitFor({ state: "visible", timeout: 20_000 });

    const heading = await page.locator("h2").first().innerText();

    if (heading.includes("Entreprise")) {
      const orgInput = page.locator('input[type="text"]').first();
      if ((await orgInput.inputValue()) === "") {
        await orgInput.fill("E2E Main Org");
      }
    } else if (heading.includes("Produits")) {
      const ex = page.locator('button:has-text("Ajouter des exemples agro")');
      if (await ex.isVisible().catch(() => false)) await ex.click();
    } else if (heading.includes("Clients")) {
      const ex = page.locator(
        'button:has-text("Ajouter des exemples de clients")'
      );
      if (await ex.isVisible().catch(() => false)) await ex.click();
    } else if (heading.includes("Première vente")) {
      const qty = page.locator('input[aria-label^="Quantité pour"]').first();
      if (await qty.count()) await qty.fill("2");
    }

    await primary.first().click();
    await page.waitForTimeout(600);
  }

  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

/** Provisioning one-shot : inscription + parcours complet des 7 étapes. */
async function provision(
  page: Page,
  email: string,
  password: string
): Promise<void> {
  await page.goto(`${BASE}/signup`);
  await page.fill('input[name="firstName"]', "E2E");
  await page.fill('input[name="lastName"]', "Main");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(onboarding|dashboard)/, { timeout: 30_000 });

  if (page.url().includes("/dashboard")) return;
  await completeOnboarding(page);
}
export default async function globalSetup(): Promise<void> {
  // Sweep des artefacts d'audit d'un run précédent (findings.jsonl) : une seule
  // exécution par run Playwright, aucun risque de concurrence entre workers.
  fs.rmSync(path.join(process.cwd(), "e2e", "artifacts"), {
    recursive: true,
    force: true,
  });

  assertTargetPolicy();
  const { email, password } = ensureCredentials();
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ baseURL: BASE });
    const page = await ctx.newPage();

    let loggedIn = await tryLogin(page, email, password);
    if (!loggedIn) {
      // Compte absent (premier run) : provisionnement complet, une seule fois.
      await provision(page, email, password);
      loggedIn = true;
    } else {
      // Compte existant : compléter l'onboarding s'il est encore incomplet.
      await page.goto(`${BASE}/dashboard`);
      await page.waitForTimeout(2_500);
      if (page.url().includes("/login")) {
        throw new Error("Session E2E invalide : connexion impossible au dashboard.");
      }
      if (page.url().includes("/onboarding")) {
        await completeOnboarding(page);
      }
    }

    if (!loggedIn) throw new Error("Authentification E2E impossible.");
    await ctx.storageState({ path: STATE_PATH });
    await ctx.close();
  } finally {
    await browser.close();
  }
}
