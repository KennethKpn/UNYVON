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