import type { ModelMetadata, ModelPrices } from "./catalog-entry.js";
import { lookupPrice, type PriceTable } from "./price-table.js";

export interface ProviderModelInfo {
  contextWindow?: number;
  maxOutputTokens?: number;
  vision?: boolean;
  reasoning?: boolean;
  prices?: ModelPrices;
}

const PRESET_CONTEXT_ENV = [
  "OPENAI_PROXY_CONTEXT_WINDOW",
  "CLAUDE_CODE_MAX_CONTEXT_TOKENS",
];
const PRESET_MAX_TOKENS_ENV = ["OPENAI_PROXY_MAX_TOKENS"];
const PRESET_REASONING_ENV = ["OPENAI_PROXY_REASONING"];

const REASONING_FAMILY =
  /claude-(opus|sonnet|fable)|gpt-5|^o[1-9]|glm-5|nemotron/i;

function presetNumber(
  env: Record<string, string>,
  names: readonly string[],
): number | null {
  for (const name of names) {
    const value = Number(env[name]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: three layers, first answer wins: the provider's
 * own listing, the vendored LiteLLM price table by model family, then the
 * preset's per-endpoint constants in the Connection's env layer. Each value
 * records its layer so a wrong number can be traced. The table writes
 * `supports_reasoning` only for a model that reasons, so a listed model
 * without the flag does not.
 */
export function layerMetadata(input: {
  upstreamId: string;
  provider: ProviderModelInfo | null;
  table: PriceTable;
  presetEnv: Record<string, string>;
}): ModelMetadata {
  const { upstreamId, provider, table, presetEnv } = input;
  const row = lookupPrice(table, upstreamId);
  const limits =
    provider?.contextWindow !== undefined
      ? {
          contextWindow: provider.contextWindow,
          maxOutputTokens: provider.maxOutputTokens ?? null,
          source: "provider" as const,
        }
      : row?.max_input_tokens !== undefined
        ? {
            contextWindow: row.max_input_tokens,
            maxOutputTokens: row.max_output_tokens ?? row.max_tokens ?? null,
            source: "table" as const,
          }
        : presetNumber(presetEnv, PRESET_CONTEXT_ENV) !== null
          ? {
              contextWindow: presetNumber(presetEnv, PRESET_CONTEXT_ENV),
              maxOutputTokens: presetNumber(presetEnv, PRESET_MAX_TOKENS_ENV),
              source: "preset" as const,
            }
          : {
              contextWindow: null,
              maxOutputTokens: null,
              source: "none" as const,
            };
  const prices: {
    value: ModelPrices | null;
    source: ModelMetadata["source"]["prices"];
  } =
    provider?.prices !== undefined
      ? { value: provider.prices, source: "provider" }
      : row?.input_cost_per_token !== undefined &&
          row.output_cost_per_token !== undefined
        ? {
            value: {
              inputPerToken: row.input_cost_per_token,
              outputPerToken: row.output_cost_per_token,
              cacheReadPerToken: row.cache_read_input_token_cost ?? null,
              cacheWritePerToken: row.cache_creation_input_token_cost ?? null,
            },
            source: "table",
          }
        : { value: null, source: "none" };
  const reasoning =
    provider?.reasoning ??
    row?.supports_reasoning ??
    (presetEnv[PRESET_REASONING_ENV[0]!] !== undefined
      ? presetEnv[PRESET_REASONING_ENV[0]!] === "1"
      : row
        ? false
        : REASONING_FAMILY.test(upstreamId) || null);
  return {
    contextWindow: limits.contextWindow,
    maxOutputTokens: limits.maxOutputTokens,
    reasoning,
    vision: provider?.vision ?? row?.supports_vision ?? null,
    cacheControl: /claude/i.test(upstreamId) ? "anthropic" : null,
    thinkingFormat: /glm/i.test(upstreamId) ? "zai" : null,
    prices: prices.value,
    source: { limits: limits.source, prices: prices.source },
  };
}
