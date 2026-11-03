import { afterEach, describe, expect, it, vi } from "vitest";
import { BOB_HOST, IBM_LITELLM_HOST } from "api-server-api";

import { createProviderKeyProbe } from "../../modules/connections/infrastructure/provider-key-probe.js";

/**
 * TEST_OVERVIEW: a model provider key that passes its check names the account
 * it belongs to whenever the provider tells that key: an Anthropic OAuth token
 * by the email and organization of its profile, an Anthropic or OpenAI key by
 * the organization header of the model list, an IBM LiteLLM key by the user
 * its key info names, a Bob key by the user of its profile, and a Bedrock key
 * by the AWS account of its inference profiles. The account is extra: a lookup
 * that fails, or an answer that names nobody, leaves the check passed without
 * an account.
 */

type Route = (headers: Record<string, string>) => Response;

function stubFetch(routes: Record<string, Route>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    calls.push({ url, headers });
    const route = routes[url];
    if (!route) throw new TypeError("fetch failed");
    return route(headers);
  });
  return calls;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });

const ANTHROPIC_MODELS = "https://api.anthropic.com/v1/models";
const ANTHROPIC_PROFILE = "https://api.anthropic.com/api/oauth/profile";

describe("provider key probe account", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const probe = (templateId: string, region?: string) =>
    createProviderKeyProbe().probe(
      templateId,
      "the-key",
      region ? { region } : {},
    );

  // TEST_SCENARIO: an Anthropic OAuth token asks its profile with the same token after the model list, and the check names the profile's email and organization, so two Anthropic subscriptions can be told apart.
  it("names the email and organization of an Anthropic OAuth token", async () => {
    const calls = stubFetch({
      [ANTHROPIC_MODELS]: () => json({ data: [] }),
      [ANTHROPIC_PROFILE]: () =>
        json({
          account: { uuid: "u-1", email: "user@example.com" },
          organization: { uuid: "o-1", name: "Example Org" },
        }),
    });
    await expect(probe("anthropic-oauth")).resolves.toEqual({
      ok: true,
      account: "user@example.com (Example Org)",
    });
    expect(calls.map((c) => c.url)).toEqual([
      ANTHROPIC_MODELS,
      ANTHROPIC_PROFILE,
    ]);
    expect(calls[1]?.headers["authorization"]).toBe("Bearer the-key");
    expect(calls[1]?.headers["anthropic-beta"]).toBe("oauth-2025-04-20");
  });

  // TEST_SCENARIO: a token without the profile scope gets a 403 from the profile route; the check still passes and falls back to the organization the model list's header names.
  it("falls back to the organization header when the profile is refused", async () => {
    stubFetch({
      [ANTHROPIC_MODELS]: () =>
        json(
          { data: [] },
          { headers: { "anthropic-organization-id": "org-uuid" } },
        ),
      [ANTHROPIC_PROFILE]: () => new Response("{}", { status: 403 }),
    });
    await expect(probe("anthropic-oauth")).resolves.toEqual({
      ok: true,
      account: "organization org-uuid",
    });
  });

  // TEST_SCENARIO: a profile route that cannot be reached and a model list without the header leave the check passed, with no account.
  it("passes without an account when the profile cannot be reached", async () => {
    stubFetch({ [ANTHROPIC_MODELS]: () => json({ data: [] }) });
    await expect(probe("anthropic-oauth")).resolves.toEqual({ ok: true });
  });

  // TEST_SCENARIO: an Anthropic or OpenAI API key has no profile route it may read, so the check names the organization of the model list's response header.
  it.each([
    ["anthropic", ANTHROPIC_MODELS, "anthropic-organization-id", "org-uuid"],
    [
      "openai",
      "https://api.openai.com/v1/models",
      "openai-organization",
      "acme",
    ],
  ])(
    "names the organization header of a %s key",
    async (templateId, url, header, value) => {
      stubFetch({ [url]: () => json({}, { headers: { [header]: value } }) });
      await expect(probe(templateId)).resolves.toEqual({
        ok: true,
        account: `organization ${value}`,
      });
    },
  );

  // TEST_SCENARIO: an IBM LiteLLM key asks its own key info after the model list, and the check names the user that info names.
  it("names the user of an IBM LiteLLM key", async () => {
    const calls = stubFetch({
      [`https://${IBM_LITELLM_HOST}/v1/models`]: () => json({ data: [] }),
      [`https://${IBM_LITELLM_HOST}/key/info`]: () =>
        json({ info: { user_id: "user@example.com", spend: 1 } }),
    });
    await expect(probe("ibm-litellm")).resolves.toEqual({
      ok: true,
      account: "user@example.com",
    });
    expect(calls[1]?.headers["authorization"]).toBe("Bearer the-key");
  });

  // TEST_SCENARIO: a LiteLLM key whose info names no user, or whose info route refuses the key, still passes, with no account.
  it.each([
    ["names no user", () => json({ info: { user_id: null } })],
    ["is refused", () => new Response("{}", { status: 403 })],
  ])("passes without an account when the key info %s", async (_, info) => {
    stubFetch({
      [`https://${IBM_LITELLM_HOST}/v1/models`]: () => json({ data: [] }),
      [`https://${IBM_LITELLM_HOST}/key/info`]: info,
    });
    await expect(probe("ibm-litellm")).resolves.toEqual({ ok: true });
  });

  // TEST_SCENARIO: Bob's check already reads its profile, so the check names the user that profile names, with no second request.
  it("names the user of a Bob key from the profile it checks", async () => {
    const calls = stubFetch({
      [`https://${BOB_HOST}/admin/v1/profile`]: () =>
        json({ user_id: "user@example.com", instances: [] }),
    });
    await expect(probe("bob")).resolves.toEqual({
      ok: true,
      account: "user@example.com",
    });
    expect(calls).toHaveLength(1);
  });

  // TEST_SCENARIO: a Bob profile that is not JSON says nothing about the account, and the check still passes.
  it("passes without an account when Bob's profile is not JSON", async () => {
    stubFetch({
      [`https://${BOB_HOST}/admin/v1/profile`]: () =>
        new Response("<html>", { status: 200 }),
    });
    await expect(probe("bob")).resolves.toEqual({ ok: true });
  });

  // TEST_SCENARIO: a Bedrock key's inference profiles carry the AWS account in their ARN, so the check names that account.
  it("names the AWS account of a Bedrock key", async () => {
    stubFetch({
      "https://bedrock.eu-central-1.amazonaws.com/inference-profiles?maxResults=1":
        () =>
          json({
            inferenceProfileSummaries: [
              {
                inferenceProfileArn:
                  "arn:aws:bedrock:eu-central-1:123456789012:inference-profile/eu.anthropic.claude",
              },
            ],
          }),
    });
    await expect(probe("bedrock", "eu-central-1")).resolves.toEqual({
      ok: true,
      account: "AWS account 123456789012",
    });
  });

  // TEST_SCENARIO: an account the provider names with control characters is stored without them, as the GitHub login is.
  it("strips control characters from the account", async () => {
    stubFetch({
      [`https://${BOB_HOST}/admin/v1/profile`]: () =>
        json({ user_id: "user@example.com\u001b[2J" }),
    });
    await expect(probe("bob")).resolves.toEqual({
      ok: true,
      account: "user@example.com[2J",
    });
  });
});
