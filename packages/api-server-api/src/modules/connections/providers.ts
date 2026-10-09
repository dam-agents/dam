export type ProviderPresetType =
  "anthropic" | "ibm-litellm" | "curve-bender" | "openai" | "bob" | "bedrock";

export interface EnvMapping {
  envName: string;
  placeholder: string;
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
    { envName: "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS", placeholder: "1" },
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
      MAX_TOKENS: "8192",
    },
  );
}

export function curveBenderEnvMappings(): EnvMapping[] {
  return [
    ...liteLlmEnvMappings(
      CURVE_BENDER_HOST,
      "rits/zai-org/glm-5-3",
      "rits/zai-org/glm-5-3",
      {
        MODEL: "rits/zai-org/glm-5-3",
        CONTEXT_WINDOW: "262144",
        MAX_TOKENS: "32768",
        REASONING: "1",
      },
    ),
    { envName: "CLAUDE_CODE_MAX_CONTEXT_TOKENS", placeholder: "262144" },
  ];
}

export function openaiEnvMappings(): EnvMapping[] {
  return [
    { envName: "OPENAI_API_KEY", placeholder: DEFAULT_ENV_PLACEHOLDER },
    { envName: "OPENAI_BASE_URL", placeholder: "https://api.openai.com/v1" },
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

export interface ProviderPreset {
  id: ProviderPresetType;
  displayName: string;
  modes: readonly ProviderPresetMode[];
}

export const PROVIDERS = {
  anthropic: {
    id: "anthropic",
    displayName: "Anthropic",
    modes: [
      {
        key: "oauth",
        label: "OAuth Token",
        templateId: "anthropic-oauth",
        tokenPrefix: "sk-ant-oat",
      },
      {
        key: "api-key",
        label: "API Key",
        templateId: "anthropic",
        tokenPrefix: "sk-ant-api",
        isDefault: true,
      },
    ],
  },
  "ibm-litellm": {
    id: "ibm-litellm",
    displayName: "IBM LiteLLM ETE Proxy",
    modes: [{ key: "api-key", label: "API Token", templateId: "ibm-litellm" }],
  },
  "curve-bender": {
    id: "curve-bender",
    displayName: "Curve Bender",
    modes: [{ key: "api-key", label: "API Token", templateId: "curve-bender" }],
  },
  openai: {
    id: "openai",
    displayName: "OpenAI",
    modes: [{ key: "api-key", label: "API Key", templateId: "openai" }],
  },
  bob: {
    id: "bob",
    displayName: "Bob Shell",
    modes: [{ key: "api-key", label: "API Key", templateId: "bob" }],
  },
  bedrock: {
    id: "bedrock",
    displayName: "AWS Bedrock",
    modes: [
      { key: "api-key", label: "API Key", templateId: BEDROCK_TEMPLATE_ID },
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
