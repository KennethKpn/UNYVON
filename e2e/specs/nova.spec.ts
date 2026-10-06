    ).toBeVisible();
  });
});

test.describe("NOVA — conversation bout en bout", () => {
  test("répond après un tool réel, conserve la conversation après reload et poursuit au second tour", async ({ page }) => {
    const settled = await settleRoute(page, "/nova");
    expect(settled.ok, settled.reason ?? "page NOVA instable").toBe(true);

    await page.getByRole("button", { name: "Nouvelle conversation" }).click();

    const input = page.getByTestId("nova-message-input");
    const question = "Fais-moi un point factuel sur mon activité.";
    await input.fill(question);
    await page.getByTestId("nova-send-button").click();

    await expect(page.locator("div.whitespace-pre-wrap").filter({ hasText: question }).last()).toBeVisible();
    await expect(
      page.getByText(/J’ai consulté vos données réelles : \\d+ produits actifs, \\d+ clients actifs\./)
    ).toBeVisible({ timeout: 45_000 });
    await expect(
      page.getByText(/Chiffre d’affaires du mois : .+/)
    ).toBeVisible();

    await page.reload();
    await expect(input).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("div.whitespace-pre-wrap").filter({ hasText: question }).last()).toBeVisible();
    await expect(
      page.getByText(/Je garde le contexte de notre échange précédent/)
    ).toHaveCount(0);

    const followUp = "Et maintenant, continue avec le même contexte.";
    await input.fill(followUp);
    await page.getByTestId("nova-send-button").click();

    await expect(page.locator("div.whitespace-pre-wrap").filter({ hasText: followUp }).last()).toBeVisible();
    await expect(
      page.getByText("Je garde le contexte de notre échange précédent et je poursuis sur cette base.", { exact: true })
    ).toBeVisible({ timeout: 45_000 });
  });
});