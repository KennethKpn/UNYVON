import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium, type Page } from "@playwright/test";
import { loadEnv } from "./env";

const BASE = "http://localhost:3000";
const AUTH_DIR = ".auth";
const STATE_PATH = path.join(AUTH_DIR, "state.json");

function ensureCredentials(): { email: string; password: string } {
  let email = process.env.E2E_USER_EMAIL;
  let password = process.env.E2E_USER_PASSWORD;

  let persisted = false;
  if (!email) {
    email = `e2e.main.${crypto.randomBytes(4).toString("hex")}@test.dev`;
    persisted = true;
  }
  if (!password) {
    password = `E2e!${crypto.randomBytes(12).toString("base64url")}9`;
    persisted = true;
  }
  if (persisted) {
    const envPath = path.join(process.cwd(), ".env.local");
    const existing = fs.existsSync(envPath)
      ? fs.readFileSync(envPath, "utf8")
      : "";
    const sep = existing && !existing.endsWith("\n") ? "\n" : "";
    const add: string[] = [];
    if (!process.env.E2E_USER_EMAIL && !existing.includes("E2E_USER_EMAIL=")) {
      add.push(`E2E_USER_EMAIL=${email}`);
    }
    if (!process.env.E2E_USER_PASSWORD && !existing.includes("E2E_USER_PASSWORD=")) {
      add.push(`E2E_USER_PASSWORD=${password}`);
    }
    if (add.length > 0) {
      fs.appendFileSync(envPath, `${sep}${add.join("\n")}\n`);
    }
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

  // Wizard : on avance étape par étape jusqu'au dashboard.
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
      await qty.fill("2");
    }

    await primary.first().click();
    await page.waitForTimeout(600);
  }

  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

export default async function globalSetup(): Promise<void> {
  // Sweep des artefacts d'audit d'un run précédent (findings.jsonl) : une seule
  // exécution par run Playwright, aucun risque de concurrence entre workers.
  fs.rmSync(path.join(process.cwd(), "e2e", "artifacts"), {
    recursive: true,
    force: true,
  });

  loadEnv();
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
      // Vérifie que la session ouvre bien le dashboard (org présente).
      await page.goto(`${BASE}/dashboard`);
      await page.waitForTimeout(2_500);
      if (page.url().includes("/login")) {
        throw new Error(
          "Session E2E invalide sur /dashboard — le compte fixe doit être onboarding-complet."
        );
      }
    }

    if (!loggedIn) throw new Error("Authentification E2E impossible.");
    await ctx.storageState({ path: STATE_PATH });
    await ctx.close();
  } finally {
    await browser.close();
  }
}
