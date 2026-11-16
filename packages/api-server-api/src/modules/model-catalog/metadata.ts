import type {
  ModelMetadata,
  ModelPrices,
  ThinkingLevelMap,
} from "./catalog-entry.js";
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: deployments the platform measured or runs
 * daily, ahead of the vendored table and the preset's per-endpoint constant.
 * The table describes a family as other vendors serve it (GLM 5.3 with a
 * 131072 output cap and no word on images), and one endpoint serves models of
 * very different lengths (CurveBender's Nemotron takes 262144 tokens where its
 * DeepSeek takes 1048576). A RITS deployment's input and output share its
 * window, so its output limit is the window, which a harness must trim by its
 * prompt (Pi does from 1.5.1). `thinkingLevelMap` is the reasoning effort each
 * of Pi's thinking levels sends, null for a level the deployment lacks; such
 * a deployment takes OpenAI-style effort, as CurveBender ignores the switch
 * GLM's own vendor API uses. These are the values a Pi tuned by hand against
 * CurveBender runs with. An `internal` deployment serves the platform's own
 * calls and is never offered for a pick: CurveBender's Nemotron runs the
 * auto-mode classifier and Bob's `security` check.
 */
const KNOWN_DEPLOYMENTS: readonly {
  match: RegExp;
  window: number;
  maxOutputTokens?: number;
  vision?: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  internal?: true;
}[] = [
  { match: /nvidia-nemotron-3-ultra/i, window: 262144, internal: true },
  {
    match: /^rits\/zai-org\/glm-5-3$/i,
    window: 1048576,
    maxOutputTokens: 1048576,
    vision: false,
    thinkingLevelMap: { off: "none", xhigh: "xhigh", max: "max" },
  },
  {
    match: /^rits\/deepseek-ai\/deepseek-v4\.1-flash-1017$/i,
    window: 1048576,
    maxOutputTokens: 1048576,
    vision: true,
    thinkingLevelMap: { off: "none", max: "max" },
  },
  {
    match: /^rits\/meta-models\/muse-spark-open-816b-a42b-nvfp4$/i,
    window: 1048576,
    maxOutputTokens: 1048576,
    vision: true,
    thinkingLevelMap: { off: null, minimal: "low", xhigh: "xhigh" },
  },
  {
    match: /^rits\/ibm-research\/granite-5\.0-230b-preview-r261008a$/i,
    window: 524288,
    maxOutputTokens: 524288,
    vision: false,
    thinkingLevelMap: { off: null, minimal: "low" },
  },
];

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether a model is left out of every list a
 * person picks from. It stays in the catalog, so the platform's own calls
 * resolve it, and a pick saved before it was hidden keeps running and keeps
 * its name.
 */
export const internalModel = (upstreamId: string): boolean =>
  KNOWN_DEPLOYMENTS.some((d) => d.internal && d.match.test(upstreamId));

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
 * UNIT_BOUNDARY_DESCRIPTION: four layers, first answer wins: the provider's
 * own listing, a deployment the platform knows, the vendored LiteLLM price
 * table by model family, then the preset's per-endpoint constants in the
 * Connection's env layer. Each value records its layer so a wrong number can
 * be traced. The table writes `supports_reasoning` only for a model that
 * reasons, so a listed model without the flag does not.
 */
export function layerMetadata(input: {
  upstreamId: string;
  provider: ProviderModelInfo | null;
  table: PriceTable;
  presetEnv: Record<string, string>;
}): ModelMetadata {
  const { upstreamId, provider, table, presetEnv } = input;
  const row = lookupPrice(table, upstreamId);
  const known = KNOWN_DEPLOYMENTS.find(({ match }) => match.test(upstreamId));
  const tableOutput = row?.max_output_tokens ?? row?.max_tokens;
  const limits =
    provider?.contextWindow !== undefined
      ? {
          contextWindow: provider.contextWindow,
          maxOutputTokens: provider.maxOutputTokens ?? null,
          source: "provider" as const,
        }
      : known !== undefined
        ? {
            contextWindow: known.window,
            maxOutputTokens:
              known.maxOutputTokens ??
              tableOutput ??
              presetNumber(presetEnv, PRESET_MAX_TOKENS_ENV),
            source: "known" as const,
          }
        : row?.max_input_tokens !== undefined
          ? {
              contextWindow: row.max_input_tokens,
              maxOutputTokens: tableOutput ?? null,
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
    vision: provider?.vision ?? known?.vision ?? row?.supports_vision ?? null,
    cacheControl: /claude/i.test(upstreamId) ? "anthropic" : null,
    thinkingFormat:
      /glm/i.test(upstreamId) && !known?.thinkingLevelMap ? "zai" : null,
    thinkingLevelMap: known?.thinkingLevelMap ?? null,
    prices: prices.value,
    source: { limits: limits.source, prices: prices.source },
  };
}
