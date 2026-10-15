import type {
  CatalogEntry,
  CatalogProvider,
} from "../../model-catalog/index.js";

const displayNameOf = (
  entry: CatalogEntry,
  providers: readonly CatalogProvider[],
): string =>
  providers.find((p) => p.connectionId === entry.connectionId)?.displayName ??
  entry.alias;

const describe = (entry: CatalogEntry, provider: string): string =>
  [
    provider,
    entry.metadata.contextWindow !== null
      ? `${Math.round(entry.metadata.contextWindow / 1000)}k context`
      : null,
  ]
    .filter((p): p is string => p !== null)
    .join(" · ");

/**
 * UNIT_BOUNDARY_DESCRIPTION: the harness-facing shapes of one catalog view.
 * Codex silently drops a catalog with a missing required field, so every
 * field its `ModelInfo` struct requires is present, cloned from its bundled
 * `gpt-5.5` entry, and each entry carries the instructions template it is
 * given.
 */
export function openAiModelList(
  entries: readonly CatalogEntry[],
  providers: readonly CatalogProvider[],
): unknown {
  return {
    object: "list",
    data: entries.map((e) => {
      const provider = displayNameOf(e, providers);
      return {
        id: e.name,
        object: "model",
        type: "model",
        created: 0,
        owned_by: e.alias,
        display_name: e.upstreamId,
        description: describe(e, provider),
        metadata: {
          alias: e.alias,
          connectionId: e.connectionId,
          provider,
          upstreamId: e.upstreamId,
          dialects: e.dialects,
          contextWindow: e.metadata.contextWindow,
          maxOutputTokens: e.metadata.maxOutputTokens,
          reasoning: e.metadata.reasoning,
          vision: e.metadata.vision,
          cacheControl: e.metadata.cacheControl,
          thinkingFormat: e.metadata.thinkingFormat,
        },
      };
    }),
    has_more: false,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the models that take Codex's grammar-constrained
 * `apply_patch` custom tool. OpenAI refuses a custom tool on older models and
 * the vLLM deployments behind the proxies refuse a grammar, so every other
 * model leaves the type unset; Codex rejects the whole catalog over a
 * "function" value.
 */
const GRAMMAR_TOOL_FAMILY = /(^|\/)(gpt-5|gpt-6|o[1-9]|codex)/i;

const CODEX_REASONING_LEVELS = [
  { effort: "low", description: "Fast responses with lighter reasoning" },
  {
    effort: "medium",
    description: "Balances speed and reasoning depth for everyday tasks",
  },
  {
    effort: "high",
    description: "Greater reasoning depth for complex problems",
  },
  {
    effort: "xhigh",
    description: "Extra high reasoning depth for complex problems",
  },
];

export function codexModelCatalog(
  entries: readonly CatalogEntry[],
  providers: readonly CatalogProvider[],
  instructionsTemplate: string,
): unknown {
  return {
    models: entries.map((e, index) => {
      const reasoning = e.metadata.reasoning === true;
      const window = e.metadata.contextWindow ?? 128_000;
      return {
        slug: e.name,
        display_name: e.upstreamId,
        description: describe(e, displayNameOf(e, providers)),
        default_reasoning_level: reasoning ? "medium" : null,
        supported_reasoning_levels: reasoning ? CODEX_REASONING_LEVELS : [],
        shell_type: "shell_command",
        visibility: "list",
        supported_in_api: true,
        priority: index,
        availability_nux: null,
        upgrade: null,
        model_messages: { instructions_template: instructionsTemplate },
        include_skills_usage_instructions: true,
        include_apps_usage_instructions: true,
        include_plugin_usage_instructions: true,
        default_reasoning_summary: "none",
        support_verbosity: false,
        default_verbosity: null,
        apply_patch_tool_type: GRAMMAR_TOOL_FAMILY.test(e.upstreamId)
          ? "freeform"
          : null,
        web_search_tool_type: "text_and_image",
        truncation_policy: { mode: "tokens", limit: 10_000 },
        supports_image_detail_original: false,
        context_window: window,
        max_context_window: window,
        auto_compact_token_limit: null,
        comp_hash: null,
        experimental_supported_tools: [],
        input_modalities:
          e.metadata.vision === false ? ["text"] : ["text", "image"],
        supports_parallel_tool_calls: true,
        tool_mode: null,
        multi_agent_version: null,
        multi_agent_reasoning_effort: null,
        use_responses_lite: false,
        supports_reasoning_effort_updates: false,
        guardian: null,
        node_repl_auto_review_required: false,
        node_repl_disabled: false,
        requires_sandboxed_review: false,
        auto_review_model_override: null,
        model_specialty: null,
        minimal_client_version: "0.1.0",
      };
    }),
  };
}

export function liteLlmModelInfo(entries: readonly CatalogEntry[]): unknown {
  return {
    data: entries.map((e) => ({
      model_name: e.name,
      litellm_params: { model: e.name },
      model_info: {
        id: e.name,
        mode: "chat",
        exposed: true,
        max_input_tokens: e.metadata.contextWindow,
        max_tokens: e.metadata.maxOutputTokens,
        max_output_tokens: e.metadata.maxOutputTokens,
        supports_vision: e.metadata.vision ?? false,
        supports_reasoning: e.metadata.reasoning ?? false,
        supports_prompt_caching: e.metadata.cacheControl === "anthropic",
        input_cost_per_token: e.metadata.prices?.inputPerToken ?? null,
        output_cost_per_token: e.metadata.prices?.outputPerToken ?? null,
        cache_read_input_token_cost:
          e.metadata.prices?.cacheReadPerToken ?? null,
        cache_creation_input_token_cost:
          e.metadata.prices?.cacheWritePerToken ?? null,
      },
    })),
  };
}
