import { rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

const passwordGrantLockPath = join(
  tmpdir(),
  "platform-e2e-keycloak-password-grant.lock",
);
const passwordGrantLockPollMs = 50;
const passwordGrantLockStaleMs = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquirePasswordGrantLock(): Promise<void> {
  for (;;) {
    try {
      await writeFile(passwordGrantLockPath, String(process.pid), {
        flag: "wx",
      });
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    const held = await stat(passwordGrantLockPath).catch(() => undefined);
    if (held && Date.now() - held.mtimeMs > passwordGrantLockStaleMs) {
      await rm(passwordGrantLockPath, { force: true });
      continue;
    }
    await sleep(passwordGrantLockPollMs);
  }
}

async function oneWorkerAtATime<T>(grant: () => Promise<T>): Promise<T> {
  await acquirePasswordGrantLock();
  try {
    return await grant();
  } finally {
    await rm(passwordGrantLockPath, { force: true });
  }
}

export async function getAccessToken(
  user: { username: string; password: string } = testUser,
): Promise<string> {
  const url = `${keycloakUrl}/realms/${keycloakRealm}/protocol/openid-connect/token`;
  const res = await oneWorkerAtATime(() =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: keycloakClientId,
        username: user.username,
        password: user.password,
      }),
    }),
  );
  if (!res.ok) {
    throw new Error(
      `Keycloak token request failed: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as TokenResponse;
  return data.access_token;
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
