import { CURVE_BENDER_HOST, IBM_LITELLM_HOST } from "api-server-api";
import type { ProviderKeyProbe } from "../domain/provider-key-probe.js";

const DEFAULT_TIMEOUT_MS = 10_000;

const INVALID_KEY_MARKER =
  /"(invalid_api_key|authentication_error|token_not_found_in_db)"/;

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

const MODELS_ENDPOINTS: Record<
  string,
  { url: string; headers: (key: string) => Record<string, string> }
> = {
  anthropic: {
    url: "https://api.anthropic.com/v1/models",
    headers: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
  },
  openai: { url: "https://api.openai.com/v1/models", headers: bearer },
  "ibm-litellm": {
    url: `https://${IBM_LITELLM_HOST}/v1/models`,
    headers: bearer,
  },
  "curve-bender": {
    url: `https://${CURVE_BENDER_HOST}/v1/models`,
    headers: bearer,
  },
};

// UNIT_BOUNDARY_DESCRIPTION: Checks a model provider key by listing the provider's models with it, before the key is stored. Only a 401 whose body names an unknown or invalid key counts as a refusal: a scoped key may get a 401 on the model list and still work for inference, and a timeout, a 5xx or a proxy's 403 says nothing about the key, so those come back unverified. Templates with no model-list check here (Anthropic OAuth, Bob, Bedrock) are accepted unchecked.
export function createProviderKeyProbe(
  opts: { timeoutMs?: number } = {},
): ProviderKeyProbe {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async probe(templateId, key) {
      const endpoint = MODELS_ENDPOINTS[templateId];
      if (!endpoint) return { ok: true };
      try {
        const res = await fetch(endpoint.url, {
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
            res.status === 401 && INVALID_KEY_MARKER.test(body)
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
