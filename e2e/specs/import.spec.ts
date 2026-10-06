import { test, expect } from "@playwright/test";

test.describe("smart import — smoke fonctionnel", () => {
  test("ouvre l'espace import, crée une session puis l'annule proprement", async ({ page }) => {
    await page.goto("/import");
    await expect(
      page.getByRole("heading", { name: "Import intelligent" })
    ).toBeVisible();

    await page.getByRole("button", { name: "Nouvel import" }).click();
    await page.waitForURL(/\/import\?session=[0-9a-f-]{36}$/);
    await expect(page.getByText("Documents", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Annuler l'import" }).click();
    await expect(page.getByText("Import annulé.", { exact: true })).toBeVisible();
  });
});


test.describe("smart import — découverte", () => {
  test("reste visible après reconnexion sur le dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: /Gagner du temps|Importer/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Gagner du temps|Importer/ })).toHaveAttribute("href", "/import");
  });

  test("est proposé pendant l'onboarding", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page.getByRole("region", { name: "Importer vos données" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Importer un fichier" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Prendre une photo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Choisir des photos" })).toBeVisible();
  });
});


test.describe("smart import — upload guidé", () => {
  test("uploade réellement une photo depuis l'onboarding puis nettoie la session", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "vp-390x844", "Un seul viewport suffit pour tester l'upload réel.");
    await page.goto("/onboarding");

    const prompt = page.getByRole("region", { name: "Importer vos données" });
    await expect(prompt).toBeVisible();

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    );

    await prompt.locator('input[type="file"]').first().setInputFiles({
      name: "registre-e2e.png",
      mimeType: "image/png",
      buffer: png,
    });

    await page.waitForURL((url) => {
      const session = url.searchParams.get("session");
      return (
        url.pathname === "/import" &&
        /^[0-9a-f-]{36}$/.test(session ?? "") &&
        url.searchParams.get("returnTo") === "/onboarding" &&
        /^[1-7]$/.test(url.searchParams.get("step") ?? "")
      );
    });
    await expect(page.getByText("registre-e2e.png", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Supprimer", exact: true }).click();
    await expect(page.getByText("registre-e2e.png", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Annuler l'import" }).click();
    await expect(page.getByText("Import annulé.", { exact: true })).toBeVisible();
  });
});



test.describe("smart import — lots multi-fichiers", () => {
  test("accepte et affiche jusqu'à 5 fichiers dans le même lot", async ({ page }) => {
    await page.goto("/import");
    await page.getByRole("button", { name: "Nouvel import" }).click();
    await page.waitForURL(/\/import\?session=[0-9a-f-]{36}$/);

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    );

    const input = page.locator('input[aria-label="Fichiers à importer"]');
    await expect(input).toHaveAttribute("multiple", "");

    await input.setInputFiles(
      Array.from({ length: 5 }, (_, index) => ({
        name: `lot-${index + 1}.png`,
        mimeType: "image/png",
        buffer: png,
      }))
    );

    for (let index = 1; index <= 5; index += 1) {
      await expect(page.getByText(`lot-${index}.png`, { exact: true })).toBeVisible();
    }

    await page.getByRole("button", { name: "Annuler l'import" }).click();
    await expect(page.getByText("Import annulé.", { exact: true })).toBeVisible();
  });

  test("signale clairement un lot de plus de 5 fichiers", async ({ page }) => {
    await page.goto("/import");
    await page.getByRole("button", { name: "Nouvel import" }).click();
    await page.waitForURL(/\/import\?session=[0-9a-f-]{36}$/);

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    );

    const input = page.locator('input[aria-label="Fichiers à importer"]');
    await input.setInputFiles(
      Array.from({ length: 6 }, (_, index) => ({
        name: `too-many-${index + 1}.png`,
        mimeType: "image/png",
        buffer: png,
      }))
    );

    await expect(
      page.getByRole("alert").filter({ hasText: /jusqu'à 5 fichiers par lot/i })
    ).toBeVisible();

    await expect(page.getByText("too-many-1.png", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Annuler l'import" }).click();
    await expect(page.getByText("Import annulé.", { exact: true })).toBeVisible();
  });

  test("signale un PNG dont le MIME navigateur est incompatible", async ({ page }) => {
    await page.goto("/import");
    await page.getByRole("button", { name: "Nouvel import" }).click();
    await page.waitForURL(/\/import\?session=[0-9a-f-]{36}$/);

    const input = page.locator('input[aria-label="Fichiers à importer"]');
    await input.setInputFiles({
      name: "mauvais-type.png",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("png-test"),
    });

    await expect(
      page.getByTestId("import-upload-error-details").filter({
        hasText: /type MIME incompatible/i,
      })
    ).toBeVisible();
    await expect(
      page.getByText("mauvais-type.png", { exact: true })
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Annuler l'import" }).click();
    await expect(page.getByText("Import annulé.", { exact: true })).toBeVisible();
  });

  test("signale un fichier dont le format n'est pas accepté", async ({ page }) => {
    await page.goto("/import");
    await page.getByRole("button", { name: "Nouvel import" }).click();
    await page.waitForURL(/\/import\?session=[0-9a-f-]{36}$/);

    const input = page.locator('input[aria-label="Fichiers à importer"]');
    await input.setInputFiles({
      name: "registre.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("test"),
    });

    await expect(page.getByRole("alert").filter({ hasText: /format non supporté/i })).toBeVisible();

    await page.getByRole("button", { name: "Annuler l'import" }).click();
    await expect(page.getByText("Import annulé.", { exact: true })).toBeVisible();
  });
});

test.describe("smart import — traitement bout en bout", () => {
  test("lit un document réel, structure ses données puis recharge la revue persistée", async ({ page }) => {
    test.skip(test.info().project.name !== "vp-1366x768", "Scénario d’intégration exécuté une seule fois; les scénarios de responsive restent couverts ailleurs.");
    await page.goto("/import");
    await page.getByRole("button", { name: "Nouvel import" }).click();
    await page.waitForURL(/\/import\?session=[0-9a-f-]{36}$/);

    const input = page.locator('input[aria-label="Fichiers à importer"]');
    const markdown = [
      "# Catalogue E2E",
      "",
      "Produit: Huile E2E",
      "Unité: L",
      "Prix vente: 2500 FCFA",
      "Stock: 7",
    ].join("\n");

    await input.setInputFiles({
      name: "catalogue-e2e.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(markdown, "utf8"),
    });

    await expect(page.getByText("catalogue-e2e.md", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Lancer le traitement" }).click();

    await expect(
      page.getByRole("status").filter({ hasText: /1 document traité.*Revue disponible/i })
    ).toBeVisible({ timeout: 60_000 });

    await expect(
      page.getByText(/name: Huile E2E.*unit: L.*sale_price: 2500.*stock_quantity: 7/)
    ).toBeVisible();

    await expect(page.getByText("Huile E2E", { exact: true })).toBeVisible();
    await page.reload();

    await expect(page.getByText("Huile E2E", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/name: Huile E2E.*unit: L.*sale_price: 2500.*stock_quantity: 7/)
    ).toBeVisible();
  });
});