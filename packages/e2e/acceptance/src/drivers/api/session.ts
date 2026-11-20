import { expect, type Page, test } from "@playwright/test";

import { submitSignInForm } from "../../auth.js";
import { baseUrl } from "../../config.js";
import type { Person } from "../../people.js";
import type { World } from "../../world.js";
import type { Pages } from "../ui/pages.js";
import type { CliAnswer, SessionDriver } from "../driver.js";

interface DeviceGrant {
  device_code: string;
  verification_uri_complete: string;
}

interface TokenAnswer {
  error?: string;
  access_token?: string;
}

/** UNIT_BOUNDARY_DESCRIPTION: the realm and client the CLI signs in with, as `dam auth login` discovers them from the install. */
async function cliAuthConfig(): Promise<{
  issuer: string;
  cliClientId: string;
}> {
  const res = await fetch(`${baseUrl}/api/auth/config`);
  expect(res.ok, `the install's auth config answered ${res.status}`).toBe(true);
  return (await res.json()) as { issuer: string; cliClientId: string };
}

async function startDeviceGrant(
  issuer: string,
  clientId: string,
): Promise<DeviceGrant> {
  const res = await fetch(`${issuer}/protocol/openid-connect/auth/device`, {
    method: "POST",
    body: new URLSearchParams({
      client_id: clientId,
      scope: "openid profile email offline_access",
    }),
  });
  expect(res.status, "Keycloak started no device grant").toBe(200);
  return (await res.json()) as DeviceGrant;
}

async function pollDeviceGrant(
  issuer: string,
  clientId: string,
  deviceCode: string,
): Promise<TokenAnswer> {
  const res = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: clientId,
      device_code: deviceCode,
    }),
  });
  return (await res.json()) as TokenAnswer;
}

/** UNIT_BOUNDARY_DESCRIPTION: the person signs in on Keycloak's device page and answers its question; Keycloak's own page, not the platform's web UI. */
async function answerInTheBrowser(
  page: Page,
  person: Person,
  grant: DeviceGrant,
  answer: CliAnswer,
): Promise<void> {
  await page.goto(grant.verification_uri_complete);
  await submitSignInForm(page, person.account);
  const consent = page.waitForResponse((res) =>
    new URL(res.url()).pathname.endsWith("/login-actions/consent"),
  );
  await page
    .getByRole("button", {
      name: answer === "allows" ? "Yes" : "No",
      exact: true,
    })
    .click();
  await consent;
}

function usernameIn(token: string): string | undefined {
  const payload = token.split(".")[1];
  if (payload === undefined) return undefined;
  return (
    JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      preferred_username?: string;
    }
  ).preferred_username;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the session capability over the public API: a sign-in is a token from Keycloak, the Terms gate is what the api-server answers a token whose owner has not accepted them, and the CLI's sign-in is the device grant `dam auth login` runs, answered on Keycloak's device page in a browser, as a person answers it. A link to follow belongs to the web UI and skips here.
 */
export function apiSession(world: World, pages: Pages): SessionDriver {
  let terms: { version: string; text: string } | undefined;
  let cli: TokenAnswer | undefined;
  return {
    async signIn(person: Person) {
      await person.token();
      world.note({ step: "signed in", persona: person.persona });
    },
    async expectAskedForTerms(person) {
      const res = await fetch(`${baseUrl}/api/trpc/agents.list?batch=1`, {
        headers: { Authorization: `Bearer ${await person.token()}` },
      });
      const body = (await res.json()) as { error?: string };
      world.note({ step: "agents asked for", status: res.status, body });
      expect(res.status, "the install served the agents").toBe(412);
      expect(body.error).toBe("terms_stale");
    },
    async readTerms(person) {
      const res = await fetch(`${baseUrl}/api/terms`, {
        headers: { Authorization: `Bearer ${await person.token()}` },
      });
      expect(res.ok, `the Terms answered ${res.status}`).toBe(true);
      terms = (await res.json()) as { version: string; text: string };
      world.note({ step: "terms read", version: terms.version });
    },
    async expectTermsShown(person) {
      expect(terms, `${person.persona} read no Terms`).toBeDefined();
      const current = await person.api.terms.current.query();
      expect(terms!.version).toBe(current.version);
      expect(terms!.text.trim()).not.toBe("");
    },
    async followSignedOut() {
      test.skip(true, "a link to follow is the web UI's");
    },
    async expectAt() {
      test.skip(true, "a link to follow is the web UI's");
    },
    async signInCli(person, answer) {
      const { issuer, cliClientId } = await cliAuthConfig();
      const grant = await startDeviceGrant(issuer, cliClientId);
      await answerInTheBrowser(
        await pages.fresh(person),
        person,
        grant,
        answer,
      );
      cli = await pollDeviceGrant(issuer, cliClientId, grant.device_code);
      world.note({
        step: "cli sign-in answered",
        persona: person.persona,
        answer,
        error: cli.error,
        token: cli.access_token !== undefined,
      });
    },
    async expectCliSignedIn(person, signedIn) {
      expect(cli, `${person.persona} signed no CLI in`).toBeDefined();
      if (!signedIn) {
        expect(cli!.access_token).toBeUndefined();
        expect(cli!.error).toBe("access_denied");
        return;
      }
      expect(cli!.error).toBeUndefined();
      expect(cli!.access_token).toBeTruthy();
      expect(usernameIn(cli!.access_token!)).toBe(person.account.username);
    },
  };
}
