import { expect, test } from "@playwright/test";

import { baseUrl, testUser } from "../config.js";

const storageStatePath = "./.auth/user.json";

test("login via Keycloak and accept terms", async ({ page }) => {
  await page.goto(baseUrl);

  await page.waitForURL(/\/realms\/platform\/protocol\/openid-connect\/auth/);
  await page.locator("#username").fill(testUser.username);
  await page.locator("#password").fill(testUser.password);
  await page.getByRole("button", { name: /sign in/i }).click();

  await page.waitForURL(
    (url) =>
      url.origin === baseUrl && !url.pathname.startsWith("/auth/callback"),
  );

  const termsButton = page.getByRole("button", {
    name: /I accept the Terms of Use/,
  });
  const appSidebar = page.getByTestId("app-sidebar");

  await expect(termsButton.or(appSidebar)).toBeVisible();

  if (await termsButton.isVisible()) {
    await termsButton.click();
    await page.waitForURL(`${baseUrl}/`);
  }
  await expect(appSidebar).toBeVisible();

  await page.context().storageState({ path: storageStatePath });
});
