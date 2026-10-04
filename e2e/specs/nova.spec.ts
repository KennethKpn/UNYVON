import { test, expect } from "@playwright/test";
import { settleRoute } from "../helpers";

test.describe("NOVA — interface conversationnelle", () => {
  test("expose toujours le champ de conversation et le bouton d'envoi", async ({ page }) => {
    const settled = await settleRoute(page, "/nova");

    expect(
      settled.ok,
      `page instable : ${settled.reason ?? "?"} (url ${page.url()})`
    ).toBe(true);

    await expect(page.getByRole("heading", { name: "NOVA" })).toBeVisible();
    await expect(page.getByTestId("nova-message-input")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Envoyer" })
    ).toBeVisible();
    await expect(
      page.getByText("Conversation avec NOVA")
    ).toBeVisible();
  });
});
