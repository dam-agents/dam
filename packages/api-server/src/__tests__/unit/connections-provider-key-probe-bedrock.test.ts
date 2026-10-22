import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProviderKeyTarget } from "../../modules/connections/domain/provider-key-probe.js";
import { createProviderKeyProbe } from "../../modules/connections/infrastructure/provider-key-probe.js";

/**
 * TEST_OVERVIEW: a Bedrock API key is tried on the inference-profile list of
 * the Connection's region, as a bearer token. Bedrock answers a wrong,
 * malformed or expired key with a 403 that says so, and that refuses the key.
 * A 403 that does not name the key — a key without permission to list
 * profiles, which may still invoke models — a 5xx, a network error or a
 * Connection without a region says nothing about the key and comes back
 * unverified.
 */

const message = (text: string) => JSON.stringify({ Message: text });

function stubFetch(res: () => Response) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string> });
    return res();
  });
  return calls;
}

describe("provider key probe for Bedrock", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const probe = (
    key = "ABSK-key",
    target: ProviderKeyTarget = { region: "eu-west-1" },
  ) => createProviderKeyProbe().probe("bedrock", key, target);

  // TEST_SCENARIO: the key is sent as a bearer token to the inference-profile list of the Connection's region; a key Bedrock accepts comes back ok.
  it("accepts a key the region's profile list answers", async () => {
    const calls = stubFetch(
      () => new Response('{"inferenceProfileSummaries":[]}', { status: 200 }),
    );
    await expect(probe()).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://bedrock.eu-west-1.amazonaws.com/inference-profiles?maxResults=1",
    );
    expect(calls[0]?.headers["authorization"]).toBe("Bearer ABSK-key");
  });

  // TEST_SCENARIO: Bedrock's 403 for a key that fails authentication, has no valid prefix, or has expired refuses the key so it is not saved.
  it.each([
    "Authentication failed: Please make sure your API Key is valid.",
    "Invalid API Key format: Must start with pre-defined prefix",
    "Bearer Token has expired",
  ])("refuses a key Bedrock answers with %s", async (text) => {
    stubFetch(() => new Response(message(text), { status: 403 }));
    await expect(probe("wrong")).resolves.toEqual({
      ok: false,
      reason: "refused",
      detail: "HTTP 403",
    });
  });

  // TEST_SCENARIO: a 403 that does not name the key, a 401, a 503 and a network error say nothing about the key, so it comes back unverified and its save goes through.
  it.each([
    [
      "a 403 for a missing permission",
      () =>
        new Response(
          message(
            "User: arn:aws:iam::123456789012:user/x is not authorized to perform: bedrock:ListInferenceProfiles",
          ),
          { status: 403 },
        ),
    ],
    [
      "a 401 naming the key",
      () => new Response(message("Bearer Token has expired"), { status: 401 }),
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
    await expect(probe()).resolves.toMatchObject({
      ok: false,
      reason: "unverified",
    });
  });

  // TEST_SCENARIO: without a region there is no host to ask, so the key comes back unverified without a request.
  it("leaves the key unverified when no region is known", async () => {
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    await expect(probe("ABSK-key", {})).resolves.toMatchObject({
      ok: false,
      reason: "unverified",
    });
    expect(calls).toHaveLength(0);
  });
});
