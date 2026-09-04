export type ProviderPresetType = "anthropic" | "ibm-litellm" | "openai" | "bob";

export interface EnvMapping {
  envName: string;
  placeholder: string;
}

export const DEFAULT_ENV_PLACEHOLDER = "dummy-placeholder";

export interface InjectionConfig {
  headerName: string;
  valueFormat?: string;
  queryParamName?: string;
  http2?: boolean;
}

export const IBM_LITELLM_HOST = "ete-litellm.ai-models.vpc.res.ibm.com";
const IBM_LITELLM_BASE_URL = `https://${IBM_LITELLM_HOST}`;

export const BOB_INFERENCE_PREFIX_REWRITE = {
  prefix: "/inference/v1/",
  replacement: "/v1/",
} as const;

export const IBM_LITELLM_BOB_MODEL = "aws/claude-opus-4-8";

export function ibmLitellmEnvMappings(): EnvMapping[] {
  return [
    { envName: "ANTHROPIC_AUTH_TOKEN", placeholder: "sk-dummy" },
    { envName: "ANTHROPIC_BASE_URL", placeholder: IBM_LITELLM_BASE_URL },
    { envName: "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS", placeholder: "1" },
    { envName: "OPENAI_PROXY_URL", placeholder: IBM_LITELLM_BASE_URL },
    { envName: "OPENAI_PROXY_MODEL", placeholder: "aws/claude-opus-4-8" },
    { envName: "OPENAI_PROXY_CONTEXT_WINDOW", placeholder: "200000" },
    { envName: "OPENAI_PROXY_MAX_TOKENS", placeholder: "8192" },
    { envName: "OPENAI_API_KEY", placeholder: DEFAULT_ENV_PLACEHOLDER },
    { envName: "OPENAI_BASE_URL", placeholder: IBM_LITELLM_BASE_URL },
    { envName: "OPENAI_MODEL", placeholder: "gpt-5.5" },
    { envName: "BOB_GATEWAY_URL", placeholder: IBM_LITELLM_BASE_URL },
    { envName: "BOBSHELL_API_KEY", placeholder: "sk-dummy" },
  ];
}

export function openaiEnvMappings(): EnvMapping[] {
  return [
    { envName: "OPENAI_API_KEY", placeholder: DEFAULT_ENV_PLACEHOLDER },
    { envName: "OPENAI_BASE_URL", placeholder: "https://api.openai.com/v1" },
  ];
}

export interface BobModelPins {
  model?: string;
  agentId?: string;
  teamId?: string;
  maxCost?: string;
  chatMode?: string;
}

export const BOB_HOST = "api.us-east.bob.ibm.com";
const BOB_PLACEHOLDER = "dummy-placeholder";

export function bobEnvMappings(pins: BobModelPins = {}): EnvMapping[] {
  const out: EnvMapping[] = [
    { envName: "BOBSHELL_API_KEY", placeholder: BOB_PLACEHOLDER },
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

export function bobPinsFromEnvMappings(
  envMappings: readonly EnvMapping[] | undefined,
): BobModelPins {
  const lookup = (name: string) =>
    envMappings?.find((m) => m.envName === name)?.placeholder;
  const pins: BobModelPins = {};
  const model = lookup("BOB_SHELL_MODEL");
  const agentId = lookup("BOB_INSTANCE_ID");
  const teamId = lookup("BOB_TEAM_ID");
  const maxCost = lookup("BOB_MAX_COINS");
  const chatMode = lookup("BOB_CHAT_MODE");
  if (model) pins.model = model;
  if (agentId) pins.agentId = agentId;
  if (teamId) pins.teamId = teamId;
  if (maxCost) pins.maxCost = maxCost;
  if (chatMode) pins.chatMode = normalizeBobChatMode(chatMode);
  return pins;
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
  defaultEnvMappings: EnvMapping[];
  injection?: InjectionConfig;
  extraInjections?: readonly InjectionConfig[];
}

export interface ProviderPreset {
  id: ProviderPresetType;
  displayName: string;
  hostPattern: string;
  pathPattern?: string;
  modes: readonly ProviderPresetMode[];
}

export const PROVIDERS = {
  anthropic: {
    id: "anthropic",
    displayName: "Anthropic",
    hostPattern: "api.anthropic.com",
    modes: [
      {
        key: "oauth",
        label: "OAuth Token",
        templateId: "anthropic-oauth",
        tokenPrefix: "sk-ant-oat",
        defaultEnvMappings: [
          {
            envName: "CLAUDE_CODE_OAUTH_TOKEN",
            placeholder: DEFAULT_ENV_PLACEHOLDER,
          },
        ],
      },
      {
        key: "api-key",
        label: "API Key",
        templateId: "anthropic",
        tokenPrefix: "sk-ant-api",
        isDefault: true,
        defaultEnvMappings: [
          {
            envName: "ANTHROPIC_API_KEY",
            placeholder: DEFAULT_ENV_PLACEHOLDER,
          },
        ],
        injection: { headerName: "x-api-key", valueFormat: "{value}" },
      },
    ],
  },
  "ibm-litellm": {
    id: "ibm-litellm",
    displayName: "IBM LiteLLM ETE Proxy",
    hostPattern: IBM_LITELLM_HOST,
    modes: [
      {
        key: "api-key",
        label: "API Token",
        templateId: "ibm-litellm",
        defaultEnvMappings: ibmLitellmEnvMappings(),
      },
    ],
  },
  openai: {
    id: "openai",
    displayName: "OpenAI",
    hostPattern: "api.openai.com",
    pathPattern: "/v1/*",
    modes: [
      {
        key: "api-key",
        label: "API Key",
        templateId: "openai",
        defaultEnvMappings: openaiEnvMappings(),
      },
    ],
  },
  bob: {
    id: "bob",
    displayName: "Bob Shell",
    hostPattern: BOB_HOST,
    modes: [
      {
        key: "api-key",
        label: "API Key",
        templateId: "bob",
        defaultEnvMappings: bobEnvMappings(),
        injection: {
          headerName: "Authorization",
          valueFormat: "Apikey {value}",
        },
        extraInjections: [
          { headerName: "X-Bobshell-Internal", queryParamName: "key" },
        ],
      },
    ],
  },
} satisfies Record<ProviderPresetType, ProviderPreset>;

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
