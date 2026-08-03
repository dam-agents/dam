import { expect, test } from "@playwright/test";

import { baseUrl, testUser } from "../../config.js";

// Runs before 01-auth (alphabetical, same "auth" project) and so faces the
// Terms gate on a fresh install — the leg that made #3107 stick on the
// dashboard. The flow id is deliberately bogus: the picker only validates it
// when an agent is picked, so reaching the picker is the whole assertion.
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

  // Whichever comes first, both paths have to land on the picker: acceptance
  // resumes the parked destination instead of the dashboard.
  await expect(termsButton.or(picker)).toBeVisible();
  if (await termsButton.isVisible()) await termsButton.click();

  await expect(picker).toBeVisible();
  await page.waitForURL(
    (url) =>
      url.pathname === "/slack/bind" &&
      url.searchParams.get("flow") === bindFlowId,
  );
});
