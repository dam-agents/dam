// Single source of truth for model-provider definitions; the server catalog,
// UI, and CLI all derive from it.

export type ProviderPresetType = "anthropic" | "ibm-litellm" | "openai" | "bob";

// `placeholder` is the literal env value Envoy rewrites to the real credential at egress.
export interface EnvMapping {
  envName: string;
  placeholder: string;
}

export const DEFAULT_ENV_PLACEHOLDER = "dummy-placeholder";

// `queryParamName` moves the credential from `headerName` into that URL query param at egress.
export interface InjectionConfig {
  headerName: string;
  valueFormat?: string;
  queryParamName?: string;
  // Terminate this host's gateway chain as HTTP/2 so injection lands on a gRPC
  // stream (e.g. Modal). Omit for ordinary HTTP/1.1 REST hosts.
  http2?: boolean;
}

export const IBM_LITELLM_HOST = "ete-litellm.ai-models.vpc.res.ibm.com";
const IBM_LITELLM_BASE_URL = `https://${IBM_LITELLM_HOST}`;

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
  ];
}

export interface BobModelPins {
  model?: string;
  agentId?: string;
  teamId?: string;
  maxCoins?: string;
  chatMode?: string;
}

// Bob downgrades to a legacy backend when BOBSHELL_API_KEY starts with `sk-`/`pk-`; the placeholder must not.
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
  push("BOB_MAX_COINS", pins.maxCoins);
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
  const maxCoins = lookup("BOB_MAX_COINS");
  const chatMode = lookup("BOB_CHAT_MODE");
  if (model) pins.model = model;
  if (agentId) pins.agentId = agentId;
  if (teamId) pins.teamId = teamId;
  if (maxCoins) pins.maxCoins = maxCoins;
  if (chatMode) pins.chatMode = chatMode;
  return pins;
}

export const BOB_CHAT_MODES = ["plan", "code", "advanced", "ask"] as const;

export interface ProviderPresetMode {
  key: string;
  label: string;
  templateId: string;
  tokenPrefix?: string;
  isDefault?: boolean;
  defaultEnvMappings: EnvMapping[];
  // injection/extraInjections feed credential injection; read by the secrets module today, not yet the catalog.
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
    // Scope injection to /v1/* so other host endpoints don't get a stray Authorization header.
    pathPattern: "/v1/*",
    modes: [
      {
        key: "api-key",
        label: "API Key",
        templateId: "openai",
        defaultEnvMappings: [
          { envName: "OPENAI_API_KEY", placeholder: DEFAULT_ENV_PLACEHOLDER },
        ],
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
        // `Apikey` prefix; `Bearer` would trigger JWT auth.
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

// Built from the modes so the template→provider relation isn't hand-maintained.
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

export function providerTypeForTemplateId(
  templateId: string,
): ProviderPresetType | null {
  return TEMPLATE_TO_PROVIDER.get(templateId) ?? null;
}

// tokenPrefix match wins; otherwise the default (or only) mode.
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
