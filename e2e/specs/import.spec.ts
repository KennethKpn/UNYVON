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