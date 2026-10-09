import type { ProviderPresetType } from "../../../types.js";

interface ProviderRowDef {
  type: ProviderPresetType;
  description: string;
}

export const IBM_LITELLM_DESCRIPTION =
  "IBM's LiteLLM proxy for Claude, GPT and other models — Anthropic, OpenAI Chat and Responses APIs.";

export const CURVE_BENDER_DESCRIPTION =
  "GLM 5.3 on RITS via LiteLLM. Nemotron is reserved for Claude's auto-permission classifier.";

export const PROVIDER_ROWS: readonly ProviderRowDef[] = [
  {
    type: "ibm-litellm",
    description: IBM_LITELLM_DESCRIPTION,
  },
  {
    type: "curve-bender",
    description: CURVE_BENDER_DESCRIPTION,
  },
  {
    type: "bob",
    description: "IBM's model endpoint for Bob Shell.",
  },
  {
    type: "anthropic",
    description:
      "Claude models for Claude and Pi. API keys also support OpenAI Chat Completions; OAuth is Claude-only.",
  },
  {
    type: "openai",
    description:
      "OpenAI models for Codex and Pi via Chat Completions and Responses APIs.",
  },
  {
    type: "bedrock",
    description:
      "Models available in your AWS region for Claude and Pi, using a Bedrock API key.",
  },
];

export function offeredProviderRows(
  allow?: readonly ProviderPresetType[],
  recommended?: ProviderPresetType,
): readonly ProviderRowDef[] {
  const offered = allow
    ? PROVIDER_ROWS.filter((row) => allow.includes(row.type))
    : PROVIDER_ROWS;
  if (!recommended) return offered;
  return [...offered].sort(
    (a, b) => Number(b.type === recommended) - Number(a.type === recommended),
  );
}
