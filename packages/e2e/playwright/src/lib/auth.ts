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

const loginAttemptsWhileBruteForceLockHolds = 10;
const bruteForceLockBackoffMs = 1_000;

function requestToken(user: {
  username: string;
  password: string;
}): Promise<Response> {
  const url = `${keycloakUrl}/realms/${keycloakRealm}/protocol/openid-connect/token`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: keycloakClientId,
      username: user.username,
      password: user.password,
    }),
  });
}

export async function getAccessToken(
  user: { username: string; password: string } = testUser,
): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const res = await requestToken(user);
    if (res.ok) {
      const data = (await res.json()) as TokenResponse;
      return data.access_token;
    }
    const body = await res.text();
    const refusedAsInvalidGrant =
      res.status === 400 && body.includes("invalid_grant");
    if (
      !refusedAsInvalidGrant ||
      attempt >= loginAttemptsWhileBruteForceLockHolds
    ) {
      throw new Error(`Keycloak token request failed: ${res.status} ${body}`);
    }
    await new Promise((r) => setTimeout(r, bruteForceLockBackoffMs));
  }
}

export async function acceptTerms(api: ApiClient): Promise<void> {
  const current = await api.terms.current.query();
  await api.terms.accept.mutate({ version: current.version });
}

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
