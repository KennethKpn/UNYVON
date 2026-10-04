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
