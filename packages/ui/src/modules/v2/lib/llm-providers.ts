import type { SecretView } from "api-server-api";

import type { Harness } from "./harnesses.js";

export type LlmProviderId =
  | "anthropic-api"
  | "anthropic-oauth"
  | "ibm-litellm"
  | "bob"
  | "openai";

type AnthropicVerifyEnv = "ANTHROPIC_API_KEY" | "CLAUDE_CODE_OAUTH_TOKEN";

export interface LlmProvider {
  id: LlmProviderId;
  label: string;
  description: string;
  secretType: "anthropic" | "ibm-litellm" | "bob" | "openai";
  placeholder: string;
  /** Env var that identifies an existing secret of this provider; also the
   *  verify target for Anthropic. Absent verify ⇒ create-and-trust. */
  envName: string;
  verifyEnvName?: AnthropicVerifyEnv;
}

export const LLM_PROVIDERS: readonly LlmProvider[] = [
  {
    id: "anthropic-oauth",
    label: "Anthropic OAuth",
    description: "Claude Code OAuth token from `claude setup-token`.",
    secretType: "anthropic",
    placeholder: "sk-ant-oat01-…",
    envName: "CLAUDE_CODE_OAUTH_TOKEN",
    verifyEnvName: "CLAUDE_CODE_OAUTH_TOKEN",
  },
  {
    id: "anthropic-api",
    label: "Anthropic API",
    description: "Anthropic API key (sk-ant-api…).",
    secretType: "anthropic",
    placeholder: "sk-ant-api03-…",
    envName: "ANTHROPIC_API_KEY",
    verifyEnvName: "ANTHROPIC_API_KEY",
  },
  {
    id: "ibm-litellm",
    label: "IBM LiteLLM",
    description: "IBM LiteLLM ETE proxy API token.",
    secretType: "ibm-litellm",
    placeholder: "sk-…",
    envName: "ANTHROPIC_AUTH_TOKEN",
  },
  {
    id: "bob",
    label: "Bob Shell",
    description: "Bob Shell API key.",
    secretType: "bob",
    placeholder: "your Bob Shell API key",
    envName: "BOBSHELL_API_KEY",
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "OpenAI API key (sk-…).",
    secretType: "openai",
    placeholder: "sk-…",
    envName: "OPENAI_API_KEY",
  },
];

// Each harness uses its own credential: Claude Code on Anthropic/LiteLLM, Bob
// on the Bob Shell key, Codex on the OpenAI key. The provider step only offers
// the matching ones.
export function providersForHarness(harness: Harness): readonly LlmProvider[] {
  if (harness === "bob") return LLM_PROVIDERS.filter((p) => p.id === "bob");
  if (harness === "codex")
    return LLM_PROVIDERS.filter((p) => p.id === "openai");
  return LLM_PROVIDERS.filter((p) => p.id !== "bob" && p.id !== "openai");
}

export function getLlmProvider(id: LlmProviderId): LlmProvider {
  const provider = LLM_PROVIDERS.find((p) => p.id === id);
  if (!provider) throw new Error(`unknown LLM provider: ${id}`);
  return provider;
}

/**
 * An existing secret the wizard can reuse instead of creating a duplicate.
 * Matched on the provider's secret type plus its identifying env var, so an
 * Anthropic API secret never collides with an Anthropic OAuth one.
 */
export function findReusableSecret(
  provider: LlmProvider,
  secrets: readonly SecretView[],
): SecretView | undefined {
  return secrets.find(
    (s) =>
      s.type === provider.secretType &&
      (s.envMappings?.some((m) => m.envName === provider.envName) ?? false),
  );
}
