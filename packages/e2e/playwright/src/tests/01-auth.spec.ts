import { expect, test } from "@playwright/test";

import { baseUrl, testUser } from "../config.js";

const storageStatePath = "./.auth/user.json";

test("login via Keycloak and accept terms", async ({ page }) => {
  await page.goto(baseUrl);

  await page.waitForURL(/\/realms\/platform\/protocol\/openid-connect\/auth/);
  await page.locator("#username").fill(testUser.username);
  await page.locator("#password").fill(testUser.password);
  await page.locator("#kc-login").click();

  await page.waitForURL((url) => url.origin === baseUrl);
  if (page.url() === `${baseUrl}/terms`) {
    await page
      .getByRole("button", { name: /I accept the Terms of Use/ })
      .click();
    await page.waitForURL(`${baseUrl}/`);
  }
  await expect(page.getByTestId("app-sidebar")).toBeVisible();

  await page.context().storageState({ path: storageStatePath });
});
