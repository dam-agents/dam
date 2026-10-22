import { afterEach, describe, expect, it, vi } from "vitest";
import { BOB_HOST } from "api-server-api";

import { createProviderKeyProbe } from "../../modules/connections/infrastructure/provider-key-probe.js";

/**
 * TEST_OVERVIEW: a Bob Shell key is tried on Bob's model list with the Apikey
 * scheme and a User-Agent naming Bob. Bob's own invalid-key 401 is a refusal;
 * its Cloudflare 403, a 5xx or a network error says nothing about the key and
 * comes back unverified.
 */

const BOB_INVALID_KEY = JSON.stringify({
  error: "unauthorized",
  message: "API Key verification failed: Invalid or expired API Key",
});

function stubFetch(res: () => Response) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string> });
    return res();
  });
  return calls;
}

describe("provider key probe for Bob", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const probe = (templateId: string, key = "bob-key") =>
    createProviderKeyProbe().probe(templateId, key);

  // TEST_SCENARIO: a Bob key is tried on Bob's model list with the Apikey scheme and a User-Agent naming Bob, since Bob's Cloudflare rule refuses any other agent; a key Bob accepts comes back ok.
  it("accepts a key Bob's model list answers", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    await expect(probe("bob")).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://${BOB_HOST}/inference/v1/models`);
    expect(calls[0]?.headers["authorization"]).toBe("Apikey bob-key");
    expect(calls[0]?.headers["user-agent"]).toMatch(/bob/);
  });

  // TEST_SCENARIO: a wrong Bob key gets Bob's own invalid-key 401, which refuses the key so it is not saved.
  it("refuses a key Bob says is invalid", async () => {
    stubFetch(() => new Response(BOB_INVALID_KEY, { status: 401 }));
    await expect(probe("bob", "wrong")).resolves.toEqual({
      ok: false,
      reason: "refused",
      detail: "HTTP 401",
    });
  });

  // TEST_SCENARIO: a 401 without Bob's invalid-key message, a Cloudflare 403, a 5xx and a network error say nothing about the key, so the key comes back unverified and its save goes through.
  it.each([
    ["a 401 with another message", () => new Response("{}", { status: 401 })],
    [
      "a Cloudflare 403",
      () => new Response("<title>Attention Required!</title>", { status: 403 }),
    ],
    ["a 503", () => new Response("", { status: 503 })],
    [
      "a network error",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("leaves the key unverified on %s", async (_, res) => {
    stubFetch(res);
    await expect(probe("bob")).resolves.toMatchObject({
      ok: false,
      reason: "unverified",
    });
  });
});
