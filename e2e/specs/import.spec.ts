    for (let index = 1; index <= 5; index += 1) {
      await expect(page.getByText(`lot-${index}.png`, { exact: true })).toBeVisible();
    }

    await page.getByRole("button", { name: "Annuler l'import" }).click();
    await expect(page.getByText("Import annulé.", { exact: true })).toBeVisible();
  });

  test("signale clairement un lot de plus de 5 fichiers", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "vp-390x844", "Le garde-fou de taille de lot ne nécessite qu'un viewport.");
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
      page.getByTestId("import-upload-error").filter({ hasText: /jusqu.{0,2}à 5 fichiers par lot/i })
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
      page.getByTestId("import-upload-error-details").filter({ hasText: /type MIME incompatible/i })
    ).toBeVisible();
    await expect(page.getByText("mauvais-type.png", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Annuler l'import" }).click();
    await expect(page.getByText("Import annulé.", { exact: true })).toBeVisible();
  });

  test("signale un fichier dont le format n'est pas accepté", async ({ page }) => {
    await page.goto("/import");