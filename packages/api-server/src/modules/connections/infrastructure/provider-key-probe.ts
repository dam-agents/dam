import { z } from "zod";
import {
  BOB_HOST,
  CURVE_BENDER_CLOUD_GATEWAY_TEMPLATE_ID,
  CURVE_BENDER_HOST,
  hasKeyCheck,
  parseCloudGatewayEndpoint,
  IBM_LITELLM_HOST,
  type KeyCheckTemplateId,
} from "api-server-api";
import type {
  ProviderKeyProbe,
  ProviderKeyTarget,
} from "../domain/provider-key-probe.js";
import { getLogger } from "../../../core/logger.js";
import { stripControlChars } from "./github-identity.js";

const DEFAULT_TIMEOUT_MS = 10_000;

const INVALID_KEY_MARKER =
  /"(invalid_api_key|authentication_error|token_not_found_in_db)"/;

const BEDROCK_INVALID_KEY_MARKER =
  /Authentication failed: Please make sure your API Key is valid|Invalid API Key format|Bearer Token has expired/;

const BOB_USER_AGENT = "platform-bob-key-check/1";

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

const fixed = (url: string) => () => url;

const ANTHROPIC_OAUTH_HEADERS = {
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "oauth-2025-04-20",
};

type Get = (url: string, headers: Record<string, string>) => Promise<Response>;

type ProviderAccountLookup = (
  res: Response,
  key: string,
  get: Get,
) => Promise<string | undefined>;

const anthropicProfileSchema = z.object({
  account: z.object({ email: z.string().nullish() }).nullish(),
  organization: z.object({ name: z.string().nullish() }).nullish(),
});

const liteLlmKeyOwnerSchema = z.object({
  info: z.object({ user_id: z.string().nullish() }),
});

const bobProfileOwnerSchema = z.object({ user_id: z.string().nullish() });

const bedrockProfilesSchema = z.object({
  inferenceProfileSummaries: z
    .array(z.object({ inferenceProfileArn: z.string() }))
    .optional(),
});

const AWS_ACCOUNT_ID = /^\d{12}$/;

function accountName(
  email: string | null | undefined,
  organization: string | null | undefined,
): string | undefined {
  const parts = [email, organization]
    .map((p) => stripControlChars(p ?? "").trim())
    .filter((p) => p !== "");
  if (parts.length === 0) return undefined;
  return parts.length === 2 ? `${parts[0]} (${parts[1]})` : parts[0];
}

async function organizationOf(
  res: Response,
  header: string,
): Promise<string | undefined> {
  await res.body?.cancel();
  const id = res.headers.get(header);
  return id ? accountName(null, `organization ${id}`) : undefined;
}

const organizationHeader =
  (header: string): ProviderAccountLookup =>
  (res) =>
    organizationOf(res, header);

const anthropicOAuthAccount: ProviderAccountLookup = async (res, key, get) => {
  const organization = await organizationOf(res, "anthropic-organization-id");
  const profile = await get("https://api.anthropic.com/api/oauth/profile", {
    ...bearer(key),
    ...ANTHROPIC_OAUTH_HEADERS,
  });
  if (!profile.ok) {
    await profile.body?.cancel();
    if (organization) return organization;
    throw new Error(`the profile route answered HTTP ${profile.status}`);
  }
  const parsed = anthropicProfileSchema.parse(await profile.json());
  return (
    accountName(parsed.account?.email, parsed.organization?.name) ??
    organization
  );
};

const liteLlmAccount =
  (host: string): ProviderAccountLookup =>
  async (res, key, get) => {
    await res.body?.cancel();
    const info = await get(`https://${host}/key/info`, bearer(key));
    if (!info.ok) {
      await info.body?.cancel();
      throw new Error(`the key info route answered HTTP ${info.status}`);
    }
    const parsed = liteLlmKeyOwnerSchema.parse(await info.json());
    return accountName(parsed.info.user_id, null);
  };

const bobAccount: ProviderAccountLookup = async (res) =>
  accountName(bobProfileOwnerSchema.parse(await res.json()).user_id, null);

const bedrockAccount: ProviderAccountLookup = async (res) => {
  const arn = bedrockProfilesSchema.parse(await res.json())
    .inferenceProfileSummaries?.[0]?.inferenceProfileArn;
  const id = arn?.split(":")[4];
  return id && AWS_ACCOUNT_ID.test(id) ? `AWS account ${id}` : undefined;
};

const MODELS_ENDPOINTS: Record<
  KeyCheckTemplateId,
  {
    url: (target: ProviderKeyTarget) => string | null;
    missingTarget?: string;
    headers: (key: string) => Record<string, string>;
    refusedStatus?: number;
    invalidKey?: RegExp | "any-body";
    account?: ProviderAccountLookup;
  }
> = {
  anthropic: {
    url: fixed("https://api.anthropic.com/v1/models"),
    headers: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
    account: organizationHeader("anthropic-organization-id"),
  },
  "anthropic-oauth": {
    url: fixed("https://api.anthropic.com/v1/models"),
    headers: (key) => ({ ...bearer(key), ...ANTHROPIC_OAUTH_HEADERS }),
    account: anthropicOAuthAccount,
  },
  openai: {
    url: fixed("https://api.openai.com/v1/models"),
    headers: bearer,
    account: organizationHeader("openai-organization"),
  },
  "ibm-litellm": {
    url: fixed(`https://${IBM_LITELLM_HOST}/v1/models`),
    headers: bearer,
    account: liteLlmAccount(IBM_LITELLM_HOST),
  },
  "curve-bender": {
    url: fixed(`https://${CURVE_BENDER_HOST}/v1/models`),
    headers: bearer,
  },
  [CURVE_BENDER_CLOUD_GATEWAY_TEMPLATE_ID]: {
    url: ({ endpoint }) => {
      const parsed = endpoint ? parseCloudGatewayEndpoint(endpoint) : null;
      return parsed ? `${parsed.url}/models` : null;
    },
    missingTarget: "the connection names no IBM Cloud Gateway project endpoint",
    headers: bearer,
    invalidKey: "any-body",
  },
  bedrock: {
    url: ({ region }) =>
      region
        ? `https://bedrock.${region}.amazonaws.com/inference-profiles?maxResults=1`
        : null,
    missingTarget: "the connection names no region",
    headers: bearer,
    refusedStatus: 403,
    invalidKey: BEDROCK_INVALID_KEY_MARKER,
    account: bedrockAccount,
  },
  bob: {
    url: fixed(`https://${BOB_HOST}/admin/v1/profile`),
    headers: (key) => ({
      authorization: `Apikey ${key}`,
      "user-agent": BOB_USER_AGENT,
    }),
    invalidKey: /API Key verification failed: Invalid or expired API Key/,
    account: bobAccount,
  },
};

// UNIT_BOUNDARY_DESCRIPTION: Checks a model provider key by listing the provider's models with it, before the key is stored. Only a 401 whose body names an unknown or invalid key counts as a refusal: a scoped key may get a 401 on the model list and still work for inference, and a timeout, a 5xx or a proxy's 403 says nothing about the key, so those come back unverified. Bedrock lists the inference profiles of the Connection's region and answers a wrong, malformed or expired key with a 403 that says so; its 403 for a key without permission to list profiles is not a refusal. The IBM Cloud Gateway lists the models of the Connection's own project endpoint, and a 401 there refuses the key whatever its body says, because that endpoint is the key's own project. Bob's gateway answers a wrong key with its own 401 message and refuses with a Cloudflare 403 a request whose User-Agent does not name Bob, so its check names itself. Bob answers its model list with a 403 for a key it accepts everywhere else, so Bob's check asks the profile route its Bobcoin budget comes from: a key that route answers is one the platform already treats as working. A key that passes names its account where the provider tells that key: an Anthropic OAuth token by the email and organization of its profile, falling back to the organization header of the model list; an Anthropic or OpenAI API key by that header; an IBM LiteLLM key by the user of its key info; a Bob key by the user of the profile it was checked on; a Bedrock key by the AWS account in its inference profiles' ARN. The account is extra, so a lookup that fails or names nobody leaves the key passed with no account; a failed one is logged, so a broken identity route reads apart from a provider that names nobody. A template with no check here (the CurveBender deployment's, the built-in platform provider's) is accepted, marked unchecked.
export function createProviderKeyProbe(
  opts: { timeoutMs?: number } = {},
): ProviderKeyProbe {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const get: Get = (url, headers) =>
    fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  async function accountOf(
    templateId: string,
    lookup: ProviderAccountLookup | undefined,
    res: Response,
    key: string,
  ): Promise<string | undefined> {
    if (!lookup) {
      await res.body?.cancel();
      return undefined;
    }
    try {
      return await lookup(res, key, get);
    } catch (err) {
      getLogger().warn(
        {
          templateId,
          error: err instanceof Error ? err.message : String(err),
        },
        "provider key check: the key passed, but its account lookup failed",
      );
      return undefined;
    }
  }
  return {
    async probe(templateId, key, target = {}) {
      if (!hasKeyCheck(templateId)) return { ok: true, unchecked: true };
      const endpoint = MODELS_ENDPOINTS[templateId];
      const url = endpoint.url(target);
      if (!url) {
        return {
          ok: false,
          reason: "unverified",
          detail: endpoint.missingTarget ?? "the connection names no target",
        };
      }
      try {
        const res = await get(url, endpoint.headers(key));
        if (res.ok) {
          const account = await accountOf(
            templateId,
            endpoint.account,
            res,
            key,
          );
          return { ok: true, ...(account ? { account } : {}) };
        }
        const body = await res.text();
        const invalidKey = endpoint.invalidKey ?? INVALID_KEY_MARKER;
        return {
          ok: false,
          reason:
            res.status === (endpoint.refusedStatus ?? 401) &&
            (invalidKey === "any-body" || invalidKey.test(body))
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
