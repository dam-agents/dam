import { afterEach, describe, expect, it, vi } from "vitest";

import { createCredentialProbe } from "../../modules/connections/infrastructure/credential-probe.js";

/**
 * TEST_OVERVIEW: a GitHub personal access token is checked against the user
 * endpoint of its host before it is saved. A 200 passes and names the login,
 * the expiry GitHub sends in `github-authentication-token-expiration` and,
 * for a classic token, the scopes in `X-OAuth-Scopes`. A 401 fails with
 * GitHub's own message, and a 403 that asks for SSO authorization fails with
 * that. A 5xx, another 403, a timeout or a network error says nothing about
 * the token, so the check comes back unchecked.
 */

function stubFetch(res: () => Response | Promise<Response>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string> });
    return res();
  });
  return calls;
}

const probe = (host = "github.com", value = "ghp_token") =>
  createCredentialProbe().probe("github-user", host, value);

describe("GitHub token check", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // TEST_SCENARIO: a classic token GitHub accepts passes, and the check names the login, the expiry and the scopes so the user sees that they pasted the right token.
  it("passes a token GitHub accepts and names its account", async () => {
    const calls = stubFetch(
      () =>
        new Response(JSON.stringify({ login: "octocat", id: 1 }), {
          status: 200,
          headers: {
            "github-authentication-token-expiration": "2026-11-21 10:00:00 UTC",
            "x-oauth-scopes": "repo, read:org",
          },
        }),
    );
    await expect(probe()).resolves.toEqual({
      status: "passed",
      account: "octocat",
      expiresAt: "2026-11-21T10:00:00.000Z",
      scopes: ["repo", "read:org"],
    });
    expect(calls[0]?.url).toBe("https://api.github.com/user");
    expect(calls[0]?.headers["Authorization"]).toBe("Bearer ghp_token");
  });

  // TEST_SCENARIO: a fine-grained token has no scopes header and may have no expiry; the check passes with the login alone.
  it("passes a fine-grained token without scopes or expiry", async () => {
    stubFetch(
      () => new Response(JSON.stringify({ login: "octocat" }), { status: 200 }),
    );
    await expect(probe()).resolves.toEqual({
      status: "passed",
      account: "octocat",
    });
  });

  // TEST_SCENARIO: a wrong, expired or revoked token gets a 401, and the reason carries GitHub's message.
  it("fails a token GitHub refuses", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ message: "Bad credentials" }), {
          status: 401,
        }),
    );
    await expect(probe()).resolves.toEqual({
      status: "failed",
      reason: "GitHub refused the token (Bad credentials)",
    });
  });

  // TEST_SCENARIO: a token an organization has not authorized for SSO gets a 403 with the X-GitHub-SSO header, and the reason says what to do.
  it("fails a token that needs SSO authorization", async () => {
    stubFetch(
      () =>
        new Response("{}", {
          status: 403,
          headers: { "x-github-sso": "required; url=https://github.com/x" },
        }),
    );
    await expect(probe()).resolves.toMatchObject({
      status: "failed",
      reason: expect.stringMatching(/SSO authorization/),
    });
  });

  // TEST_SCENARIO: an outage, a rate limit or a network failure says nothing about the token, so the check is unchecked with the reason, not failed.
  it.each([
    ["a 5xx", () => new Response("", { status: 502 }), /HTTP 502/],
    ["a plain 403", () => new Response("{}", { status: 403 }), /HTTP 403/],
    [
      "a network error",
      () => Promise.reject(new Error("connect ETIMEDOUT")),
      /^GitHub could not be reached$/,
    ],
    [
      "a timeout",
      () =>
        Promise.reject(
          Object.assign(new Error("aborted"), { name: "TimeoutError" }),
        ),
      /^GitHub did not answer in time$/,
    ],
  ] as const)("is unchecked on %s", async (_name, res, reason) => {
    stubFetch(res);
    await expect(probe()).resolves.toEqual({
      status: "unchecked",
      reason: expect.stringMatching(reason),
    });
  });

  // TEST_SCENARIO: a GitHub Enterprise Server token is checked at /api/v3/user on its own host, and a GHE.com tenancy token at the api. host of the tenancy.
  it.each([
    ["ghe.acme.com", "https://ghe.acme.com/api/v3/user"],
    ["acme.ghe.com", "https://api.acme.ghe.com/user"],
  ])("checks a %s token at its host", async (host, url) => {
    const calls = stubFetch(
      () => new Response(JSON.stringify({ login: "me" }), { status: 200 }),
    );
    await probe(host);
    expect(calls[0]?.url).toBe(url);
  });

  // TEST_SCENARIO: a fetch error can quote the request it failed on, and the reason is stored on the Connection and shown to the user, so the reason never carries the error's text or the token.
  it("keeps the error text and the token out of the reason", async () => {
    stubFetch(() =>
      Promise.reject(new Error("request with Bearer ghp_secret failed")),
    );
    const outcome = await probe("github.com", "ghp_secret");
    expect(JSON.stringify(outcome)).not.toContain("ghp_secret");
    expect(outcome.reason).toBe("GitHub could not be reached");
  });
});
