import { afterEach, describe, expect, it, vi } from "vitest";
import { CURVE_BENDER_CLOUD_GATEWAY_TEMPLATE_ID } from "api-server-api";

import {
  providerKeyTargetOf,
  type ProviderKeyTarget,
} from "../../modules/connections/domain/provider-key-probe.js";
import { createProviderKeyProbe } from "../../modules/connections/infrastructure/provider-key-probe.js";

/**
 * TEST_OVERVIEW: an IBM Cloud Gateway key is tried on the model list of the
 * Connection's own project endpoint, as a bearer token, before it is stored.
 * A 401 there refuses the key. Any other failure, and a Connection whose
 * endpoint is missing or not a gateway project endpoint, says nothing about
 * the key and comes back unverified, so nothing is sent outside the gateway.
 */

const ENDPOINT = "https://eu-de.rhai.ibm.com/v1/projects/p-1/inference";

function stubFetch(res: () => Response) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string> });
    return res();
  });
  return calls;
}

describe("provider key probe for the IBM Cloud Gateway", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const probe = (target: ProviderKeyTarget = { endpoint: ENDPOINT }) =>
    createProviderKeyProbe().probe(
      CURVE_BENDER_CLOUD_GATEWAY_TEMPLATE_ID,
      "gw-key",
      target,
    );

  // TEST_SCENARIO: the Connection's endpoint is read from its env contributions, the same value the agent's router and listing use.
  it("reads the endpoint from the Connection's contributions", () => {
    expect(
      providerKeyTargetOf([
        { kind: "env", name: "OPENAI_API_KEY", placeholder: "dummy" },
        { kind: "env", name: "OPENAI_BASE_URL", placeholder: ENDPOINT },
      ]),
    ).toEqual({ endpoint: ENDPOINT });
  });

  // TEST_SCENARIO: a key the project's model list answers passes; the request goes to that list with the key as a bearer token.
  it("accepts a key the project's model list answers", async () => {
    const calls = stubFetch(
      () => new Response('{"data":[{"id":"glm"}]}', { status: 200 }),
    );
    await expect(probe()).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      {
        url: `${ENDPOINT}/models`,
        headers: { authorization: "Bearer gw-key" },
      },
    ]);
  });

  // TEST_SCENARIO: the gateway's 401 refuses the key whatever its body says, so a wrong key is not saved.
  it.each(['{"error":"unauthorized"}', ""])(
    "refuses a key answered with a 401 (%s)",
    async (body) => {
      stubFetch(() => new Response(body, { status: 401 }));
      await expect(probe()).resolves.toEqual({
        ok: false,
        reason: "refused",
        detail: "HTTP 401",
      });
    },
  );

  // TEST_SCENARIO: a 403, a 404 from an endpoint that does not list models, and a 503 say nothing certain about the key.
  it.each([403, 404, 503])(
    "leaves a key unverified on HTTP %i",
    async (status) => {
      stubFetch(() => new Response("", { status }));
      await expect(probe()).resolves.toEqual({
        ok: false,
        reason: "unverified",
        detail: `HTTP ${status}`,
      });
    },
  );

  // TEST_SCENARIO: with no endpoint, or one outside the gateway, the probe sends the key nowhere.
  it.each<[string, ProviderKeyTarget]>([
    ["no endpoint", {}],
    [
      "another host",
      { endpoint: "https://evil.example/v1/projects/p/inference" },
    ],
  ])("sends nothing with %s", async (_, target) => {
    const calls = stubFetch(() => new Response("", { status: 200 }));
    await expect(probe(target)).resolves.toEqual({
      ok: false,
      reason: "unverified",
      detail: "the connection names no IBM Cloud Gateway project endpoint",
    });
    expect(calls).toEqual([]);
  });
});
