import type { HarnessView } from "../templates/types.js";

export type ProviderPresetType =
  | "anthropic"
  | "ibm-litellm"
  | "curve-bender"
  | "openai"
  | "bob"
  | "bedrock"
  | "platform";

export interface EnvMapping {
  envName: string;
  placeholder: string;
}

export function harnessFits(
  catalog: { harnesses: readonly HarnessView[] },
  harness: string,
  type: ProviderPresetType,
  templateId?: string,
): boolean {
  const entry = catalog.harnesses.find((h) => h.name === harness);
  if (templateId === "anthropic-oauth" && harness !== "claude-code")
    return false;
  return !!entry && (!entry.providers || entry.providers.includes(type));
}

export const DEFAULT_ENV_PLACEHOLDER = "dummy-placeholder";

export const IBM_LITELLM_HOST = "ete-litellm.ai-models.vpc.res.ibm.com";
export const CURVE_BENDER_HOST = "litellm.cb.ete.res.ibm.com";
export const CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID = "curve-bender-deployment";

export const BOB_INFERENCE_PREFIX_REWRITE = {
  prefix: "/inference/v1/",
  replacement: "/v1/",
} as const;

function liteLlmEnvMappings(
  host: string,
  openaiModel: string,
  bobModel: string,
  proxy: Record<string, string>,
): EnvMapping[] {
  const baseUrl = `https://${host}`;
  return [
    { envName: "ANTHROPIC_AUTH_TOKEN", placeholder: "sk-dummy-placeholder" },
    { envName: "ANTHROPIC_BASE_URL", placeholder: baseUrl },
    { envName: "OPENAI_PROXY_URL", placeholder: baseUrl },
    ...Object.entries(proxy).map(([key, placeholder]) => ({
      envName: `OPENAI_PROXY_${key}`,
      placeholder,
    })),
    { envName: "OPENAI_API_KEY", placeholder: DEFAULT_ENV_PLACEHOLDER },
    { envName: "OPENAI_BASE_URL", placeholder: baseUrl },
    { envName: "OPENAI_MODEL", placeholder: openaiModel },
    { envName: "BOB_GATEWAY_URL", placeholder: baseUrl },
    { envName: "BOBSHELL_API_KEY", placeholder: DEFAULT_ENV_PLACEHOLDER },
    { envName: "BOB_SHELL_MODEL", placeholder: bobModel },
  ];
}

export function ibmLitellmEnvMappings(): EnvMapping[] {
  return liteLlmEnvMappings(
    IBM_LITELLM_HOST,
    "gpt-5.5",
    "aws/claude-sonnet-4-6",
    {
      MODEL: "aws/claude-opus-4-8",
      CONTEXT_WINDOW: "200000",
      MAX_TOKENS: "32768",
    },
  );
}

const CURVE_BENDER_WORK_MODEL = "rits/deepseek-ai/DeepSeek-V4.1-Flash-1017";
/**
 * UNIT_BOUNDARY_DESCRIPTION: the window the RITS deployment of the work model
 * serves, measured against its own vLLM router (max_model_len 1048576, a live
 * 270k-token prompt accepted, max_tokens refused above the same figure, so
 * input and output share it). It feeds the catalog's window for the models the
 * endpoint does not describe, which Claude Code's per-model map and Pi read, so
 * a smaller number compacts long sessions below the real ceiling. The endpoint
 * serves other models on shorter windows, so a measured window for one of them
 * outranks this constant (model-catalog metadata).
 */
const CURVE_BENDER_CONTEXT_WINDOW = "1048576";

export function curveBenderEnvMappings(): EnvMapping[] {
  return [
    ...liteLlmEnvMappings(
      CURVE_BENDER_HOST,
      CURVE_BENDER_WORK_MODEL,
      CURVE_BENDER_WORK_MODEL,
      {
        MODEL: CURVE_BENDER_WORK_MODEL,
        CONTEXT_WINDOW: CURVE_BENDER_CONTEXT_WINDOW,
        MAX_TOKENS: "32768",
        REASONING: "1",
      },
    ),
    ...[
      "ANTHROPIC_MODEL",
      "ANTHROPIC_DEFAULT_MODEL",
      "ANTHROPIC_DEFAULT_FABLE_MODEL",
      "ANTHROPIC_DEFAULT_OPUS_MODEL",
      "ANTHROPIC_DEFAULT_SONNET_MODEL",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    ].map((envName) => ({ envName, placeholder: CURVE_BENDER_WORK_MODEL })),
    { envName: "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS", placeholder: "1" },
    { envName: "CLAUDE_CODE_AUTO_MODE_SERVER", placeholder: "0" },
    { envName: "ENABLE_TOOL_SEARCH", placeholder: "false" },
    {
      envName: "CLAUDE_CODE_MAX_CONTEXT_TOKENS",
      placeholder: CURVE_BENDER_CONTEXT_WINDOW,
    },
  ];
}

export function openaiEnvMappings(): EnvMapping[] {
  return [
    { envName: "OPENAI_API_KEY", placeholder: DEFAULT_ENV_PLACEHOLDER },
    { envName: "OPENAI_BASE_URL", placeholder: "https://api.openai.com/v1" },
  ];
}

export const PLATFORM_LLM_TEMPLATE_ID = "platform-llm";

export function platformLlmEnvMappings(endpoint: {
  baseUrl: string;
  model: string;
  name: string;
}): EnvMapping[] {
  return [
    { envName: "PLATFORM_LLM_BASE_URL", placeholder: endpoint.baseUrl },
    { envName: "PLATFORM_LLM_NAME", placeholder: endpoint.name },
    { envName: "ANTHROPIC_AUTH_TOKEN", placeholder: DEFAULT_ENV_PLACEHOLDER },
    { envName: "ANTHROPIC_BASE_URL", placeholder: endpoint.baseUrl },
    { envName: "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS", placeholder: "1" },
    { envName: "OPENAI_API_KEY", placeholder: DEFAULT_ENV_PLACEHOLDER },
    { envName: "OPENAI_BASE_URL", placeholder: `${endpoint.baseUrl}/v1` },
    { envName: "OPENAI_MODEL", placeholder: endpoint.model },
  ];
}
export const BEDROCK_TEMPLATE_ID = "bedrock";

export const BEDROCK_REGION_PATTERN = "[a-z]{2}(?:-gov)?-[a-z]+-\\d";

export function bedrockEnvMappings(): EnvMapping[] {
  return [
    {
      envName: "AWS_BEARER_TOKEN_BEDROCK",
      placeholder: DEFAULT_ENV_PLACEHOLDER,
    },
    { envName: "AWS_BEDROCK_FORCE_HTTP1", placeholder: "1" },
  ];
}

export interface BedrockPins {
  region: string;
  model?: string;
}

export interface BobModelPins {
  model?: string;
  agentId?: string;
  teamId?: string;
  maxCost?: string;
  chatMode?: string;
}

export const BOB_HOST = "api.us-east.bob.ibm.com";
const BOB_BASE_URL = `https://${BOB_HOST}`;

export function bobEnvMappings(pins: BobModelPins = {}): EnvMapping[] {
  const out: EnvMapping[] = [
    { envName: "BOBSHELL_API_KEY", placeholder: DEFAULT_ENV_PLACEHOLDER },
    { envName: "BOB_DEFAULT_GATEWAY_URL", placeholder: BOB_BASE_URL },
  ];
  const push = (envName: string, value?: string) => {
    const trimmed = value?.trim();
    if (trimmed) out.push({ envName, placeholder: trimmed });
  };
  push("BOB_SHELL_MODEL", pins.model);
  push("BOB_INSTANCE_ID", pins.agentId);
  push("BOB_TEAM_ID", pins.teamId);
  push("BOB_MAX_COINS", pins.maxCost);
  push("BOB_CHAT_MODE", pins.chatMode);
  return out;
}

export const BOB_CHAT_MODES = ["agent", "plan", "ask"] as const;

const BOB_LEGACY_CHAT_MODES: Record<string, (typeof BOB_CHAT_MODES)[number]> = {
  code: "agent",
  advanced: "agent",
};

export function normalizeBobChatMode(mode: string | undefined): string {
  const trimmed = mode?.trim() ?? "";
  return BOB_LEGACY_CHAT_MODES[trimmed] ?? trimmed;
}

export interface ProviderPresetMode {
  key: string;
  label: string;
  templateId: string;
  tokenPrefix?: string;
  isDefault?: boolean;
}

export type ProviderAlias =
  "ibm" | "cb" | "anthropic" | "openai" | "bedrock" | "bob" | "platform";

export const PROVIDER_ALIASES: readonly ProviderAlias[] = [
  "ibm",
  "cb",
  "anthropic",
  "openai",
  "bedrock",
  "bob",
  "platform",
];

export const PROVIDER_ALIAS_RE = /^[a-z][a-z0-9-]*$/;

export interface ProviderPreset {
  id: ProviderPresetType;
  alias: ProviderAlias;
  displayName: string;
  modes: readonly ProviderPresetMode[];
  /**
   * UNIT_BOUNDARY_DESCRIPTION: the provider's own service answers Claude
   * Code's auto-mode check on the model call itself, so a session there needs
   * no classifier of its own and the router passes the classifier call
   * through.
   */
  serverAutoMode?: boolean;
}

export const PROVIDERS = {
  anthropic: {
    id: "anthropic",
    alias: "anthropic",
    displayName: "Anthropic",
    serverAutoMode: true,
    modes: [
      {
        key: "oauth",
        label: "OAuth token",
        templateId: "anthropic-oauth",
        tokenPrefix: "sk-ant-oat",
      },
      {
        key: "api-key",
        label: "API key",
        templateId: "anthropic",
        tokenPrefix: "sk-ant-api",
        isDefault: true,
      },
    ],
  },
  "ibm-litellm": {
    id: "ibm-litellm",
    alias: "ibm",
    displayName: "IBM ETE LiteLLM Proxy",
    serverAutoMode: true,
    modes: [{ key: "api-key", label: "API token", templateId: "ibm-litellm" }],
  },
  "curve-bender": {
    id: "curve-bender",
    alias: "cb",
    displayName: "CurveBender custom key",
    modes: [
      { key: "api-key", label: "API token", templateId: "curve-bender" },
      {
        key: "deployment",
        label: "Deployment key",
        templateId: CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
      },
    ],
  },
  openai: {
    id: "openai",
    alias: "openai",
    displayName: "OpenAI",
    modes: [{ key: "api-key", label: "API key", templateId: "openai" }],
  },
  bob: {
    id: "bob",
    alias: "bob",
    displayName: "Bob Shell",
    modes: [{ key: "api-key", label: "API key", templateId: "bob" }],
  },
  bedrock: {
    id: "bedrock",
    alias: "bedrock",
    displayName: "AWS Bedrock",
    modes: [
      { key: "api-key", label: "API key", templateId: BEDROCK_TEMPLATE_ID },
    ],
  },
  platform: {
    id: "platform",
    alias: "platform",
    displayName: "Platform",
    modes: [
      {
        key: "built-in",
        label: "Built in",
        templateId: PLATFORM_LLM_TEMPLATE_ID,
      },
    ],
  },
} satisfies Record<ProviderPresetType, ProviderPreset>;

export const BALANCE_PROVIDER_TYPES: ReadonlySet<ProviderPresetType> = new Set([
  "bob",
  "ibm-litellm",
  "curve-bender",
]);

export const KEY_CHECK_TEMPLATE_IDS = [
  "anthropic",
  "anthropic-oauth",
  "openai",
  "ibm-litellm",
  "curve-bender",
  "bob",
  "bedrock",
] as const;
export type KeyCheckTemplateId = (typeof KEY_CHECK_TEMPLATE_IDS)[number];

export function hasKeyCheck(
  templateId: string,
): templateId is KeyCheckTemplateId {
  return (KEY_CHECK_TEMPLATE_IDS as readonly string[]).includes(templateId);
}

export const PROVIDER_PRESET_TYPES = Object.keys(
  PROVIDERS,
) as readonly ProviderPresetType[];

export function isProviderPresetType(type: string): type is ProviderPresetType {
  return type in PROVIDERS;
}

const TEMPLATE_TO_PROVIDER: ReadonlyMap<string, ProviderPresetType> = new Map(
  PROVIDER_PRESET_TYPES.flatMap((type) =>
    PROVIDERS[type].modes.map(
      (mode) => [mode.templateId, type] as [string, ProviderPresetType],
    ),
  ),
);

export const PROVIDER_TEMPLATE_IDS: ReadonlySet<string> = new Set(
  TEMPLATE_TO_PROVIDER.keys(),
);

export const SHARED_KB_TEMPLATE_ID = "shared-knowledge-base";

export const S3_COMPATIBLE_TEMPLATE_ID = "s3-compatible";

export function providerTypeForTemplateId(
  templateId: string,
): ProviderPresetType | null {
  return TEMPLATE_TO_PROVIDER.get(templateId) ?? null;
}

export function aliasForProviderType(type: ProviderPresetType): ProviderAlias {
  return PROVIDERS[type].alias;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether the provider behind an alias answers
 * Claude Code's auto-mode check itself, which decides if the router leaves a
 * classifier call where the harness sent it.
 */
export function hasServerAutoMode(alias: ProviderAlias): boolean {
  return PROVIDER_PRESET_TYPES.some(
    (type) =>
      PROVIDERS[type].alias === alias &&
      "serverAutoMode" in PROVIDERS[type] &&
      PROVIDERS[type].serverAutoMode === true,
  );
}

export function aliasForTemplateId(templateId: string): ProviderAlias | null {
  const type = providerTypeForTemplateId(templateId);
  return type === null ? null : aliasForProviderType(type);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a preset's name is what users see, and one
 * preset can offer more than one template under different names (the
 * deployment CurveBender beside the user-keyed one); a template without an
 * entry of its own takes its preset's name.
 */
const TEMPLATE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  [CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID]: "CurveBender",
};

export function displayNameForTemplate(templateId: string): string | null {
  const type = providerTypeForTemplateId(templateId);
  if (type === null) return null;
  return TEMPLATE_DISPLAY_NAMES[templateId] ?? PROVIDERS[type].displayName;
}

export function templateIdsForAlias(alias: ProviderAlias): string[] {
  return PROVIDER_PRESET_TYPES.filter(
    (type) => PROVIDERS[type].alias === alias,
  ).flatMap((type) => PROVIDERS[type].modes.map((mode) => mode.templateId));
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a harness's home provider is its default
 * whenever the agent holds it; a harness with none takes the shared order.
 */
export const HARNESS_HOME_PROVIDERS: Readonly<
  Record<string, readonly ProviderAlias[]>
> = {
  "claude-code": ["anthropic"],
  codex: ["openai"],
  bob: ["bob"],
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: the order granted providers are tried in as a
 * default: the harness's home providers first, then the catalog order.
 */
export function aliasOrder(alias: ProviderAlias, harness?: string): number {
  const home = harness ? (HARNESS_HOME_PROVIDERS[harness] ?? []) : [];
  const at = home.indexOf(alias);
  return at >= 0 ? at - home.length : PROVIDER_ALIASES.indexOf(alias);
}

export interface AliasedConnection {
  id: string;
  name: string;
  templateId: string;
}

export interface ProviderAliasConflict {
  alias: ProviderAlias;
  displayName: string;
  held: AliasedConnection;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: an Agent holds at most one provider Connection
 * per alias, because the alias names the provider in every qualified model
 * name and two Connections behind one alias would leave a name pointing at
 * either. Returns the held Connection that blocks the candidate.
 */
export function providerAliasConflict(
  granted: readonly AliasedConnection[],
  candidate: AliasedConnection,
): ProviderAliasConflict | null {
  const type = providerTypeForTemplateId(candidate.templateId);
  if (type === null) return null;
  const alias = aliasForProviderType(type);
  const held = granted.find(
    (c) => c.id !== candidate.id && aliasForTemplateId(c.templateId) === alias,
  );
  if (!held) return null;
  const heldType = providerTypeForTemplateId(held.templateId)!;
  return {
    alias,
    displayName:
      displayNameForTemplate(held.templateId) ??
      PROVIDERS[heldType].displayName,
    held,
  };
}

export function templateIdForProvider(
  type: ProviderPresetType,
  value: string,
): string {
  const modes: readonly ProviderPresetMode[] = PROVIDERS[type].modes;
  const matched = modes.find(
    (mode) =>
      mode.tokenPrefix !== undefined && value.startsWith(mode.tokenPrefix),
  );
  return (matched ?? modes.find((mode) => mode.isDefault) ?? modes[0])
    .templateId;
}
