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
