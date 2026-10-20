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

const CURVE_BENDER_WORK_MODEL = "rits/zai-org/glm-5-3";

export function curveBenderEnvMappings(): EnvMapping[] {
  return [
    ...liteLlmEnvMappings(
      CURVE_BENDER_HOST,
      CURVE_BENDER_WORK_MODEL,
      CURVE_BENDER_WORK_MODEL,
      {
        MODEL: CURVE_BENDER_WORK_MODEL,
        CONTEXT_WINDOW: "256000",
        MAX_TOKENS: "32768",
        REASONING: "1",
      },
    ),
    ...[
      "ANTHROPIC_MODEL",
      "ANTHROPIC_DEFAULT_MODEL",
      "ANTHROPIC_DEFAULT_FABLE_MODEL",
      "ANTHROPIC_DEFAULT_OPUS_MODEL",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    ].map((envName) => ({ envName, placeholder: CURVE_BENDER_WORK_MODEL })),
    {
      envName: "ANTHROPIC_DEFAULT_SONNET_MODEL",
      placeholder: "rits/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4",
    },
    { envName: "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS", placeholder: "1" },
    { envName: "CLAUDE_CODE_AUTO_MODE_SERVER", placeholder: "0" },
    { envName: "ENABLE_TOOL_SEARCH", placeholder: "false" },
    { envName: "CLAUDE_CODE_MAX_CONTEXT_TOKENS", placeholder: "256000" },
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
}

export const PROVIDERS = {
  anthropic: {
    id: "anthropic",
    alias: "anthropic",
    displayName: "Anthropic",
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
    modes: [{ key: "api-key", label: "API token", templateId: "ibm-litellm" }],
  },
  "curve-bender": {
    id: "curve-bender",
    alias: "cb",
    displayName: "IBM ETE LiteLLM CurveBender",
    modes: [{ key: "api-key", label: "API token", templateId: "curve-bender" }],
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

export function aliasForTemplateId(templateId: string): ProviderAlias | null {
  const type = providerTypeForTemplateId(templateId);
  return type === null ? null : aliasForProviderType(type);
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
  return { alias, displayName: PROVIDERS[heldType].displayName, held };
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
