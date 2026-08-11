import { expect, type Page } from "@playwright/test";

import {
  baseUrl,
  keycloakClientId,
  keycloakRealm,
  keycloakUrl,
  testUser,
} from "../config.js";
import type { ApiClient } from "./api-client.js";

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export async function getAccessToken(
  user: { username: string; password: string } = testUser,
): Promise<string> {
  const url = `${keycloakUrl}/realms/${keycloakRealm}/protocol/openid-connect/token`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: keycloakClientId,
      username: user.username,
      password: user.password,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Keycloak token request failed: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as TokenResponse;
  return data.access_token;
}

/** Accept the current Terms of Use for the client's user. The terms gate
 *  412s every non-terms API call until the user accepts, and only the UI
 *  login flow (01-auth) does it implicitly — self-contained API specs
 *  (the full-suite tier) must call this before anything else. */
export async function acceptTerms(api: ApiClient): Promise<void> {
  const current = await api.terms.current.query();
  await api.terms.accept.mutate({ version: current.version });
}

/** Log the browser in through Keycloak and land on the app. Full-tier specs
 *  carry no `storageState` (they are self-contained by convention), so a spec
 *  that needs a *browser* session — not just an API token — establishes it
 *  itself. Idempotent: an already-authenticated context skips straight past
 *  the Keycloak form, and the Terms gate is only clicked when it shows. */
export async function loginViaUi(page: Page): Promise<void> {
  await page.goto(baseUrl);

  const usernameField = page.locator("#username");
  const termsButton = page.getByRole("button", {
    name: /I accept the Terms of Use/,
  });
  const appSidebar = page.getByTestId("app-sidebar");

  await expect(usernameField.or(termsButton).or(appSidebar)).toBeVisible();

  if (await usernameField.isVisible()) {
    await usernameField.fill(testUser.username);
    await page.locator("#password").fill(testUser.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(
      (url) =>
        url.origin === baseUrl && !url.pathname.startsWith("/auth/callback"),
    );
    await expect(termsButton.or(appSidebar)).toBeVisible();
  }

  if (await termsButton.isVisible()) await termsButton.click();
  await expect(appSidebar).toBeVisible();
}
