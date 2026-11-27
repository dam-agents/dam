import { createServer, type Server } from "node:net";

import { expect, type Page } from "@playwright/test";

import {
  baseUrl,
  keycloakClientId,
  keycloakRealm,
  keycloakUrl,
} from "./config.js";

export interface Account {
  username: string;
  password: string;
}

const loginLockPort = Number(
  process.env.PLATFORM_E2E_LOGIN_LOCK_PORT ?? "47319",
);
const loginLockWaitMs = 120_000;

function takeLoginLock(): Promise<Server | undefined> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") resolve(undefined);
      else reject(err);
    });
    server.listen(
      { port: loginLockPort, host: "127.0.0.1", exclusive: true },
      () => {
        server.unref();
        resolve(server);
      },
    );
  });
}

async function oneLoginAtATime<T>(login: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + loginLockWaitMs;
  let lock = await takeLoginLock();
  while (!lock) {
    if (Date.now() > deadline)
      throw new Error(
        `no turn to log in to Keycloak after ${loginLockWaitMs}ms: 127.0.0.1:${loginLockPort} stayed taken`,
      );
    await new Promise((resolve) => setTimeout(resolve, 50));
    lock = await takeLoginLock();
  }
  const held = lock;
  try {
    return await login();
  } finally {
    await new Promise<void>((resolve) => held.close(() => resolve()));
  }
}

export async function accessToken(account: Account): Promise<string> {
  const res = await oneLoginAtATime(() =>
    fetch(
      `${keycloakUrl}/realms/${keycloakRealm}/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "password",
          client_id: keycloakClientId,
          username: account.username,
          password: account.password,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    ),
  );
  if (!res.ok)
    throw new Error(
      `Keycloak refused ${account.username}: ${res.status} ${await res.text()}`,
    );
  return ((await res.json()) as { access_token: string }).access_token;
}

/** UNIT_BOUNDARY_DESCRIPTION: signs in through Keycloak's page; a person who has accepted the Terms lands in the app, one who has not on the Terms page, where nothing here accepts them. */
export async function signInThroughTheBrowser(
  page: Page,
  account: Account,
  acceptedTerms = true,
): Promise<void> {
  await page.goto(baseUrl);
  const username = page.locator("#username");
  const terms = page.getByRole("button", { name: /I accept the Terms of Use/ });
  const sidebar = page.getByTestId("app-sidebar");
  await expect(username.or(terms).or(sidebar)).toBeVisible();
  if (await username.isVisible()) {
    await submitSignInForm(page, account);
    await expect(terms.or(sidebar)).toBeVisible();
  }
  if (!acceptedTerms) {
    await expect(
      terms,
      `${account.username} was not asked for the Terms`,
    ).toBeVisible();
    return;
  }
  if (await terms.isVisible()) await terms.click();
  await expect(sidebar).toBeVisible();
}

/** UNIT_BOUNDARY_DESCRIPTION: fills Keycloak's sign-in form on the page, which must show it. */
export async function submitSignInForm(
  page: Page,
  account: Account,
): Promise<void> {
  await oneLoginAtATime(async () => {
    await page.locator("#username").fill(account.username);
    await page.locator("#password").fill(account.password);
    await page
      .locator("#kc-form-login")
      .getByRole("button", { name: /sign in/i })
      .click();
    await expect(page.locator("#kc-form-login")).toBeHidden();
  });
}
