import { expect, test } from "@playwright/test";

import { baseUrl, testUser } from "../../config.js";

const bindFlowId = "e2e-deep-link-probe";
const bindDeepLink = `/slack/bind?flow=${bindFlowId}`;

test("a bind deep link survives the login roundtrip and the Terms gate (#3107)", async ({
  page,
}) => {
  await page.goto(`${baseUrl}${bindDeepLink}`);

  await page.waitForURL(/\/realms\/platform\/protocol\/openid-connect\/auth/);
  await page.locator("#username").fill(testUser.username);
  await page.locator("#password").fill(testUser.password);
  await page.getByRole("button", { name: /sign in/i }).click();

  const termsButton = page.getByRole("button", {
    name: /I accept the Terms of Use/,
  });
  const picker = page.getByRole("heading", {
    name: /connect this channel to an agent/i,
  });

  await expect(termsButton.or(picker)).toBeVisible();
  if (await termsButton.isVisible()) await termsButton.click();

  await expect(picker).toBeVisible();
  await page.waitForURL(
    (url) =>
      url.pathname === "/slack/bind" &&
      url.searchParams.get("flow") === bindFlowId,
  );
});
