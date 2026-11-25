import { expect, test } from "@playwright/test";
import { TRPCClientError } from "@trpc/client";
import type { AppRouter } from "api-server-api";

import { createApiClient, createWsApiClient } from "../../lib/api-client.js";
import { getAccessToken, submitKeycloakLoginForm } from "../../lib/auth.js";
import { baseUrl, termsGateUser } from "../../config.js";

// TEST_OVERVIEW: The auth project in declaration order: the Terms gate on both tRPC doors, then the deep-link roundtrip through the login and that gate, both on the gate account no setup accepts the Terms for. What a person meets at the gate, and the CLI's device grant, are Examples of the acceptance suite (features/account/). The shared account's login, Terms and assistant are the setup project's.

function trpcError(err: unknown): TRPCClientError<AppRouter> {
  expect(err).toBeInstanceOf(TRPCClientError);
  return err as TRPCClientError<AppRouter>;
}

// TEST_SCENARIO: Authentication and the pre-consent terms gate on BOTH tRPC transports — HTTP and WebSocket — must refuse bad bearers and gate every procedure except terms.* until terms are accepted.
test("both tRPC doors: bad bearers refused, stale terms gate all but terms.*", async () => {
  await test.step("authn — HTTP door: missing and bad bearers get 401", async () => {
    const missing = await fetch(
      `${baseUrl}/api/trpc/terms.latestAcceptance?batch=1`,
    );
    expect(missing.status).toBe(401);
    const bad = await fetch(
      `${baseUrl}/api/trpc/terms.latestAcceptance?batch=1`,
      { headers: { Authorization: "Bearer pk_not.a.real.token" } },
    );
    expect(bad.status).toBe(401);
  });

  await test.step("authn — WS door: a bad bearer is refused at the connection", async () => {
    const { api, close } = createWsApiClient("pk_not.a.real.token");
    try {
      const err = await api.terms.latestAcceptance.query().then(
        () => null,
        (e: unknown) => e,
      );
      expect(trpcError(err).data?.code).toBe("UNAUTHORIZED");
    } finally {
      close();
    }
  });

  const token = await getAccessToken(termsGateUser);

  await test.step("terms — HTTP door: 412 terms_stale for the app, terms.* exempt", async () => {
    const gated = await fetch(`${baseUrl}/api/trpc/agents.list?batch=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(gated.status).toBe(412);
    expect(((await gated.json()) as { error?: string }).error).toBe(
      "terms_stale",
    );
    expect(await createApiClient(token).terms.latestAcceptance.query()).toBe(
      null,
    );
  });

  await test.step("terms — WS door: connection admitted, procedures gated, terms.* exempt", async () => {
    const { api, close } = createWsApiClient(token);
    try {
      expect(await api.terms.latestAcceptance.query()).toBe(null);
      const refused = await api.agents.list.query().then(
        () => null,
        (e: unknown) => e,
      );
      expect(trpcError(refused).data?.code).toBe("FORBIDDEN");
      expect(
        (trpcError(refused).data as { termsStale?: boolean } | undefined)
          ?.termsStale,
      ).toBe(true);
    } finally {
      close();
    }
  });
});

// TEST_SCENARIO: The flow id is deliberately bogus: the bind page only needs to render its expired-link state to prove the deep link survived the login roundtrip and the terms gate (#3107); no real bind flow is required.
const bindFlowId = "e2e-deep-link-probe";
const bindDeepLink = `/slack/bind?flow=${bindFlowId}`;

function wireBrowserDiagnostics(page: import("@playwright/test").Page) {
  page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`[console.error] ${msg.text()}`);
  });
  page.on("requestfailed", (req) =>
    console.log(
      `[requestfailed] ${req.url()} :: ${req.failure()?.errorText ?? "?"}`,
    ),
  );
}

test("a bind deep link survives the login roundtrip and the Terms gate (#3107)", async ({
  page,
}) => {
  wireBrowserDiagnostics(page);
  await page.goto(`${baseUrl}${bindDeepLink}`);

  await page.waitForURL(/\/realms\/platform\/protocol\/openid-connect\/auth/);

  const termsButton = page.getByRole("button", {
    name: /I accept the Terms of Use/,
  });
  const expiredLink = page.getByRole("heading", {
    name: /this link is invalid or has expired/i,
  });

  await submitKeycloakLoginForm(page, termsGateUser);
  await expect(termsButton.or(expiredLink)).toBeVisible();
  if (await termsButton.isVisible()) await termsButton.click();

  await expect(expiredLink).toBeVisible();
  await page.waitForURL(
    (url) =>
      url.pathname === "/slack/bind" &&
      url.searchParams.get("flow") === bindFlowId,
  );
});
