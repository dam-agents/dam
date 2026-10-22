import {
  BOB_HOST,
  CURVE_BENDER_HOST,
  hasKeyCheck,
  IBM_LITELLM_HOST,
  type KeyCheckTemplateId,
} from "api-server-api";
import type {
  ProviderKeyProbe,
  ProviderKeyTarget,
} from "../domain/provider-key-probe.js";

const DEFAULT_TIMEOUT_MS = 10_000;

const INVALID_KEY_MARKER =
  /"(invalid_api_key|authentication_error|token_not_found_in_db)"/;

const BEDROCK_INVALID_KEY_MARKER =
  /Authentication failed: Please make sure your API Key is valid|Invalid API Key format|Bearer Token has expired/;

const BOB_USER_AGENT = "platform-bob-key-check/1";

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

const fixed = (url: string) => () => url;

const MODELS_ENDPOINTS: Record<
  KeyCheckTemplateId,
  {
    url: (target: ProviderKeyTarget) => string | null;
    headers: (key: string) => Record<string, string>;
    refusedStatus?: number;
    invalidKey?: RegExp;
  }
> = {
  anthropic: {
    url: fixed("https://api.anthropic.com/v1/models"),
    headers: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
  },
  "anthropic-oauth": {
    url: fixed("https://api.anthropic.com/v1/models"),
    headers: (key) => ({
      ...bearer(key),
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "oauth-2025-04-20",
    }),
  },
  openai: { url: fixed("https://api.openai.com/v1/models"), headers: bearer },
  "ibm-litellm": {
    url: fixed(`https://${IBM_LITELLM_HOST}/v1/models`),
    headers: bearer,
  },
  "curve-bender": {
    url: fixed(`https://${CURVE_BENDER_HOST}/v1/models`),
    headers: bearer,
  },
  bedrock: {
    url: ({ region }) =>
      region
        ? `https://bedrock.${region}.amazonaws.com/inference-profiles?maxResults=1`
        : null,
    headers: bearer,
    refusedStatus: 403,
    invalidKey: BEDROCK_INVALID_KEY_MARKER,
  },
  bob: {
    url: fixed(`https://${BOB_HOST}/inference/v1/models`),
    headers: (key) => ({
      authorization: `Apikey ${key}`,
      "user-agent": BOB_USER_AGENT,
    }),
    invalidKey: /API Key verification failed: Invalid or expired API Key/,
  },
};

// UNIT_BOUNDARY_DESCRIPTION: Checks a model provider key by listing the provider's models with it, before the key is stored. Only a 401 whose body names an unknown or invalid key counts as a refusal: a scoped key may get a 401 on the model list and still work for inference, and a timeout, a 5xx or a proxy's 403 says nothing about the key, so those come back unverified. Bedrock lists the inference profiles of the Connection's region and answers a wrong, malformed or expired key with a 403 that says so; its 403 for a key without permission to list profiles is not a refusal. Bob's gateway answers a wrong key with its own 401 message and refuses with a Cloudflare 403 a request whose User-Agent does not name Bob, so its check names itself. A template with no check here (the CurveBender deployment's, the built-in platform provider's) is accepted, marked unchecked.
export function createProviderKeyProbe(
  opts: { timeoutMs?: number } = {},
): ProviderKeyProbe {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async probe(templateId, key, target = {}) {
      if (!hasKeyCheck(templateId)) return { ok: true, unchecked: true };
      const endpoint = MODELS_ENDPOINTS[templateId];
      const url = endpoint.url(target);
      if (!url) {
        return {
          ok: false,
          reason: "unverified",
          detail: "the connection names no region",
        };
      }
      try {
        const res = await fetch(url, {
          headers: endpoint.headers(key),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) {
          await res.body?.cancel();
          return { ok: true };
        }
        const body = await res.text();
        return {
          ok: false,
          reason:
            res.status === (endpoint.refusedStatus ?? 401) &&
            (endpoint.invalidKey ?? INVALID_KEY_MARKER).test(body)
              ? "refused"
              : "unverified",
          detail: `HTTP ${res.status}`,
        };
      } catch (err) {
        return {
          ok: false,
          reason: "unverified",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
