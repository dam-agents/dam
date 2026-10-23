import type { ProviderPresetType } from "../../../types.js";

export interface ProviderRowDef {
  type: ProviderPresetType;
  description: string;
}

export const PROVIDER_ROWS: readonly ProviderRowDef[] = [
  {
    type: "ibm-litellm",
    description: "IBM's internal LiteLLM proxy — Claude on watsonx-routed AWS.",
  },
  {
    type: "bob",
    description:
      "IBM Bob Shell endpoint with twin-secret credential injection.",
  },
  {
    type: "anthropic",
    description:
      "Claude Code, Claude SDK, and any Anthropic-compatible client.",
  },
  {
    type: "openai",
    description: "GPT-family models for Codex and OpenAI-compatible agents.",
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
