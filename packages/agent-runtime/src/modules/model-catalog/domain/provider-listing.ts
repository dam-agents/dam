import type { ProviderAlias } from "api-server-api";
import type { ModelDiscoverySpec } from "../../runtime-channel/manifest.js";
import type { ModelDialect, ModelPrices } from "./catalog-entry.js";

const ALL_DIALECTS: readonly ModelDialect[] = [
  "anthropic-messages",
  "openai-chat",
  "openai-responses",
];

/**
 * UNIT_BOUNDARY_DESCRIPTION: a harness can run on a provider through the
 * Model Router only when the provider serves a dialect the harness's
 * manifest lists. Bedrock is empty: it stays on Claude Code's native path
 * until its endpoints are verified.
 */
export const PROVIDER_DIALECTS: Record<ProviderAlias, readonly ModelDialect[]> =
  {
    ibm: ALL_DIALECTS,
    cb: ALL_DIALECTS,
    anthropic: ["anthropic-messages"],
    openai: ["openai-chat", "openai-responses"],
    bedrock: [],
    bob: ["openai-chat"],
    platform: ALL_DIALECTS,
  };

export interface ProviderListing {
  spec: ModelDiscoverySpec;
  defaultBase?: string;
  keep?: (upstreamId: string) => boolean;
  harnesses?: readonly string[];
  prices?: ModelPrices;
}

const FREE: ModelPrices = {
  inputPerToken: 0,
  outputPerToken: 0,
  cacheReadPerToken: 0,
  cacheWritePerToken: 0,
};

export const ANTHROPIC_OAUTH_TEMPLATE = "anthropic-oauth";
/**
 * UNIT_BOUNDARY_DESCRIPTION: Anthropic requires this beta flag on every call
 * made with a subscription (OAuth) token, the listing included.
 */
export const ANTHROPIC_OAUTH_BETA = "oauth-2025-04-20";

const OPENAI_NON_CHAT =
  /realtime|audio|transcri|tts|whisper|dall-e|image|embedding|moderation|instruct|search|computer-use|codex-mini|babbage|davinci/i;

const openAiChatModel = (id: string): boolean =>
  /^(gpt-|o[1-9])/.test(id) && !OPENAI_NON_CHAT.test(id);

/**
 * UNIT_BOUNDARY_DESCRIPTION: Bob's gateway sits behind a Cloudflare rule that
 * refuses a request whose User-Agent does not name Bob, so the listing names
 * itself.
 */
export const BOB_LISTING_USER_AGENT = "platform-bob-catalog/1";

/**
 * UNIT_BOUNDARY_DESCRIPTION: how the catalog lists a provider's models from
 * its Connection's env layer. IBM's virtual keys get 403 on every model-info
 * route, so the LiteLLM proxies are read through `/v1/models` and take their
 * metadata from the price table; Bob's gateway is the one provider-sourced
 * listing. The catalog shows the platform's self-hosted vLLM at no cost; the
 * spend meter prices its calls with the operator's price instead. Null for
 * a template the router does not serve (Bedrock).
 */
export function listingForTemplate(templateId: string): ProviderListing | null {
  switch (templateId) {
    case "ibm-litellm":
    case "curve-bender":
      return {
        spec: {
          urlEnv: ["OPENAI_BASE_URL", "ANTHROPIC_BASE_URL"],
          tokenEnv: ["OPENAI_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
          shape: "openai-models",
        },
      };
    case "platform-llm":
      return {
        spec: {
          urlEnv: ["PLATFORM_LLM_BASE_URL", "OPENAI_BASE_URL"],
          tokenEnv: ["OPENAI_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
          credentialHeader: "authorization",
          shape: "openai-models",
        },
        prices: FREE,
      };
    case "anthropic":
      return {
        spec: {
          urlEnv: ["ANTHROPIC_BASE_URL"],
          tokenEnv: ["ANTHROPIC_API_KEY"],
          credentialHeader: "x-api-key",
          headers: { "anthropic-version": "2023-06-01" },
          shape: "openai-models",
        },
        defaultBase: "https://api.anthropic.com",
      };
    case ANTHROPIC_OAUTH_TEMPLATE:
      return {
        spec: {
          urlEnv: ["ANTHROPIC_BASE_URL"],
          tokenEnv: ["CLAUDE_CODE_OAUTH_TOKEN"],
          credentialHeader: "authorization",
          headers: {
            "anthropic-version": "2023-06-01",
            "anthropic-beta": ANTHROPIC_OAUTH_BETA,
          },
          shape: "openai-models",
        },
        defaultBase: "https://api.anthropic.com",
        harnesses: ["claude-code"],
      };
    case "openai":
      return {
        spec: {
          urlEnv: ["OPENAI_BASE_URL"],
          tokenEnv: ["OPENAI_API_KEY"],
          shape: "openai-models",
        },
        defaultBase: "https://api.openai.com/v1",
        keep: openAiChatModel,
      };
    case "bob":
      return {
        spec: {
          urlEnv: ["BOB_DEFAULT_GATEWAY_URL"],
          tokenEnv: ["BOBSHELL_API_KEY"],
          headers: { "user-agent": BOB_LISTING_USER_AGENT },
          path: "/inference/v1/model/info",
          shape: "litellm-model-info",
          fallback: { path: "/inference/v1/models" },
        },
      };
    default:
      return null;
  }
}
