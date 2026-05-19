export type SecretType =
  | "anthropic"
  | "ibm-litellm"
  | "openai"
  | "bob"
  | "generic";

/**
 * SecretTypes that have a {@link PROVIDERS} registry entry — the providers
 * rendered as cards in the Providers view. The registry is constrained
 * against this union so adding a new provider means widening this type
 * AND adding a {@link PROVIDERS} entry; TypeScript will fail if either
 * half is missing.
 */
export type ProviderPresetType = "anthropic" | "ibm-litellm" | "openai" | "bob";

/**
 * Declares a pod env var to inject into every agent instance that has access
 * to this secret. `placeholder` is the literal value written into the env
 * (typically "dummy-placeholder") — the Envoy sidecar's credential_injector
 * filter rewrites it to the real credential on outbound requests matching
 * the secret's host pattern.
 */
export interface EnvMapping {
  envName: string;
  placeholder: string;
}

export const DEFAULT_ENV_PLACEHOLDER = "dummy-placeholder";

export const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

export function isValidEnvName(name: string): boolean {
  return name.length > 0 && ENV_NAME_RE.test(name);
}

// RFC 3986 unreserved set — the only characters guaranteed safe in a URL
// query parameter name without percent-encoding. Shared by the Zod schema
// and both UI forms; keep them in sync.
export const QUERY_PARAM_RE = /^[A-Za-z0-9._~-]+$/;

/**
 * How the Envoy sidecar injects a generic secret into matching outbound
 * requests. `valueFormat` may reference the literal token `{value}`;
 * defaults to `{value}` when omitted.
 *
 * When `queryParamName` is set, a per-route Lua filter runs after the
 * Envoy credential_injector and moves the (bare) credential from the
 * `headerName` header into the URL query parameter named `queryParamName`,
 * then strips the header before the request leaves the sidecar. Use this
 * for upstreams that read the credential from the URL rather than a
 * header (e.g. APIs that accept `?key=<value>`). The `headerName` is an
 * internal-only transport in this mode — pick a name that won't collide
 * with another credential's injection on the same host (the controller
 * drops collisions to avoid `credential_injector overwrite` clobbering).
 *
 * To inject the same credential into BOTH a header AND a URL parameter
 * on the same endpoint, create two Secrets with the same host pattern —
 * one header-only, one with `queryParamName`.
 */
export interface InjectionConfig {
  headerName: string;
  valueFormat?: string;
  queryParamName?: string;
}

/** Default used when the user doesn't override it: `Authorization: Bearer <value>`. */
export const DEFAULT_INJECTION_CONFIG: InjectionConfig = {
  headerName: "Authorization",
  valueFormat: "Bearer {value}",
};

/**
 * IBM LiteLLM model pins. The IBM LiteLLM preset's default env-var bundle
 * pins all five Claude model env vars to AWS-hosted Claude IDs; the form's
 * "Advanced — model overrides" disclosure lets the user change them.
 */
export interface IbmLitellmModelPins {
  opus: string;
  sonnet: string;
  haiku: string;
  /** Subagent model — Claude Code uses this for the Task tool. */
  subagent: string;
  /** `ANTHROPIC_MODEL` — fallback when no `ANTHROPIC_DEFAULT_*_MODEL` matches. */
  default: string;
}

export const IBM_LITELLM_DEFAULT_MODEL_PINS: IbmLitellmModelPins = {
  opus: "aws/claude-opus-4-6",
  sonnet: "aws/claude-sonnet-4-6",
  haiku: "aws/claude-haiku-4-5",
  subagent: "aws/claude-opus-4-6",
  default: "aws/claude-opus-4-6",
};

const IBM_LITELLM_HOST = "ete-litellm.ai-models.vpc-int.res.ibm.com";
const IBM_LITELLM_BASE_URL = `https://${IBM_LITELLM_HOST}`;

/**
 * Builds the IBM LiteLLM env-var bundle from a model-pin set. The form
 * uses this to mint a fresh bundle when the user changes any pin in the
 * advanced disclosure; the default bundle (with `IBM_LITELLM_DEFAULT_MODEL_PINS`)
 * is what the registry stores.
 *
 * 13 entries: 1 credential placeholder, 1 endpoint pin, 2 behavior flags,
 * 5 Claude Code model pins, 4 pi-agent `openai-proxy` SPECS overrides
 * (`pi-dynamic-providers/index.ts`).
 */
export function ibmLitellmEnvMappings(
  pins: IbmLitellmModelPins = IBM_LITELLM_DEFAULT_MODEL_PINS,
): EnvMapping[] {
  return [
    { envName: "ANTHROPIC_AUTH_TOKEN", placeholder: "sk-dummy" },
    { envName: "ANTHROPIC_BASE_URL", placeholder: IBM_LITELLM_BASE_URL },
    { envName: "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS", placeholder: "1" },
    { envName: "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", placeholder: "1" },
    { envName: "ANTHROPIC_DEFAULT_OPUS_MODEL", placeholder: pins.opus },
    { envName: "ANTHROPIC_DEFAULT_SONNET_MODEL", placeholder: pins.sonnet },
    { envName: "ANTHROPIC_DEFAULT_HAIKU_MODEL", placeholder: pins.haiku },
    { envName: "CLAUDE_CODE_SUBAGENT_MODEL", placeholder: pins.subagent },
    { envName: "ANTHROPIC_MODEL", placeholder: pins.default },
    { envName: "OPENAI_PROXY_URL", placeholder: IBM_LITELLM_BASE_URL },
    { envName: "OPENAI_PROXY_MODEL", placeholder: pins.opus },
    { envName: "OPENAI_PROXY_CONTEXT_WINDOW", placeholder: "200000" },
    { envName: "OPENAI_PROXY_MAX_TOKENS", placeholder: "8192" },
  ];
}

/**
 * Reverse map: extract user-facing model pins from a stored env-mapping
 * set so the edit form can pre-populate the advanced disclosure. Falls
 * back to defaults for any pin not present.
 */
export function ibmLitellmPinsFromEnvMappings(
  envMappings: readonly EnvMapping[] | undefined,
): IbmLitellmModelPins {
  const lookup = (name: string) =>
    envMappings?.find((m) => m.envName === name)?.placeholder;
  return {
    opus:
      lookup("ANTHROPIC_DEFAULT_OPUS_MODEL") ??
      IBM_LITELLM_DEFAULT_MODEL_PINS.opus,
    sonnet:
      lookup("ANTHROPIC_DEFAULT_SONNET_MODEL") ??
      IBM_LITELLM_DEFAULT_MODEL_PINS.sonnet,
    haiku:
      lookup("ANTHROPIC_DEFAULT_HAIKU_MODEL") ??
      IBM_LITELLM_DEFAULT_MODEL_PINS.haiku,
    subagent:
      lookup("CLAUDE_CODE_SUBAGENT_MODEL") ??
      IBM_LITELLM_DEFAULT_MODEL_PINS.subagent,
    default:
      lookup("ANTHROPIC_MODEL") ?? IBM_LITELLM_DEFAULT_MODEL_PINS.default,
  };
}

export interface BobModelPins {
  model?: string;
  instanceId?: string;
  teamId?: string;
  maxCoins?: string;
  chatMode?: string;
}

// Bob CLI silently downgrades to the legacy `prod.ibm-bob-staging` backend
// when BOBSHELL_API_KEY starts with `sk-`/`pk-`; the placeholder must not.
const BOB_HOST = "api.us-east.bob.ibm.com";
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
  push("BOB_INSTANCE_ID", pins.instanceId);
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
  const instanceId = lookup("BOB_INSTANCE_ID");
  const teamId = lookup("BOB_TEAM_ID");
  const maxCoins = lookup("BOB_MAX_COINS");
  const chatMode = lookup("BOB_CHAT_MODE");
  if (model) pins.model = model;
  if (instanceId) pins.instanceId = instanceId;
  if (teamId) pins.teamId = teamId;
  if (maxCoins) pins.maxCoins = maxCoins;
  if (chatMode) pins.chatMode = chatMode;
  return pins;
}

export const BOB_CHAT_MODES = ["plan", "code", "advanced", "ask"] as const;

/**
 * One auth mode of a provider preset. Most presets have exactly one mode
 * (a Bearer API key); Anthropic has two (oauth + api-key) which differ in
 * both env-var name and Envoy injection header.
 */
export interface ProviderPresetMode {
  /** Stable mode key. Stored as the `auth-mode` annotation on the K8s
   *  Secret so reads can recover which mode was selected. */
  key: string;
  /** UI label for the mode toggle. */
  label: string;
  /** Default env-var bundle. Forms with dynamic configuration (IBM LiteLLM
   *  model overrides) compute a custom bundle and pass it as `envMappings`
   *  to `create()`; this is what `create()` falls back to otherwise. */
  defaultEnvMappings: EnvMapping[];
  /** Override the default `Authorization: Bearer {value}` injection.
   *  Set for Anthropic api-key mode (`x-api-key`); omit elsewhere. */
  injection?: InjectionConfig;
  /** Twin K8s Secret per entry; lifecycle cascaded by service. See ADR-044. */
  extraInjections?: readonly InjectionConfig[];
}

/**
 * Provider preset — a fixed (host, path, env-bundle) tuple surfaced as a
 * card in the Providers view. Replaces the per-provider scattered
 * constants. Add a new provider by adding one entry to {@link PROVIDERS}.
 */
export interface ProviderPreset {
  /** SecretType literal — the canonical id of this preset. */
  id: ProviderPresetType;
  /** Human-readable name for cards, toasts, and the connections picker. */
  displayName: string;
  /** Envoy host pattern. Also drives the per-instance leaf-cert SAN list. */
  hostPattern: string;
  /** Path scope for injection. Omit for whole-host coverage. */
  pathPattern?: string;
  /** Auth modes. Length 1 for IBM LiteLLM and OpenAI; length 2 for Anthropic. */
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
        // Claude Code SDK reads CLAUDE_CODE_OAUTH_TOKEN; sends Bearer.
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
        // @anthropic-ai/sdk reads ANTHROPIC_API_KEY; sends x-api-key.
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
        defaultEnvMappings: ibmLitellmEnvMappings(),
      },
    ],
  },
  openai: {
    id: "openai",
    displayName: "OpenAI",
    hostPattern: "api.openai.com",
    // OpenAI's API lives under /v1/*; scoping injection to that path keeps
    // status pages and other host endpoints from getting a spurious
    // Authorization header.
    pathPattern: "/v1/*",
    modes: [
      {
        key: "api-key",
        label: "API Key",
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
        defaultEnvMappings: bobEnvMappings(),
        // Opaque api-keys go in under `Apikey`; `Bearer` triggers JWT auth.
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

/** Iteration helper — every provider id that has a {@link PROVIDERS} entry. */
export const PROVIDER_PRESET_TYPES = Object.keys(
  PROVIDERS,
) as readonly ProviderPresetType[];

export function isProviderPresetType(
  type: SecretType,
): type is ProviderPresetType {
  return type in PROVIDERS;
}

export interface SecretView {
  id: string;
  name: string;
  type: SecretType;
  hostPattern: string;
  pathPattern?: string;
  /** Only set for generic secrets. */
  injectionConfig?: InjectionConfig;
  createdAt: string;
  envMappings?: EnvMapping[];
}

export interface CreateSecretInput {
  type: SecretType;
  name: string;
  value: string;
  hostPattern?: string;
  pathPattern?: string;
  injectionConfig?: InjectionConfig;
  envMappings?: EnvMapping[];
}

export interface UpdateSecretInput {
  id: string;
  name?: string;
  value?: string;
  /** Only permitted on generic secrets. */
  hostPattern?: string;
  /** `null` clears the path pattern; `undefined` leaves it unchanged. */
  pathPattern?: string | null;
  /** `null` resets to the default; `undefined` leaves it unchanged. */
  injectionConfig?: InjectionConfig | null;
  envMappings?: EnvMapping[];
}

export interface AgentAccess {
  secretIds: string[];
}

/**
 * Input for {@link SecretsService.createGithubPat}. A single GitHub PAT is
 * fanned out server-side into two `generic` secrets that share this `name`:
 * one for `api.github.com` (Bearer / `GH_TOKEN`) and one for `github.com`
 * (Basic, with the value pre-wrapped as `base64("x-access-token:" + token)`).
 */
export interface CreateGithubPatInput {
  name: string;
  token: string;
}

export interface CreateGithubPatOutput {
  name: string;
  apiSecretId: string;
  gitSecretId: string;
}

/**
 * Input for {@link SecretsService.updateGithubPat}. Replaces the token on
 * an existing PAT pair by id, re-wrapping the github.com half's basic-
 * auth value server-side so callers send `{apiSecretId, gitSecretId,
 * token}` only.
 */
export interface UpdateGithubPatInput {
  apiSecretId: string;
  gitSecretId: string;
  token: string;
}

export interface UpdateGithubPatOutput {
  apiSecretId: string;
  gitSecretId: string;
}

/** Minimal agent shape returned by `listGrantedAgents` — used by the UI's
 *  env-affecting edit confirmation to show which agents will roll. */
export interface GrantedAgentSummary {
  id: string;
  name: string;
}

export interface SecretsService {
  list(): Promise<SecretView[]>;
  create(input: CreateSecretInput): Promise<SecretView>;
  createGithubPat(input: CreateGithubPatInput): Promise<CreateGithubPatOutput>;
  updateGithubPat(input: UpdateGithubPatInput): Promise<UpdateGithubPatOutput>;
  update(input: UpdateSecretInput): Promise<void>;
  delete(id: string): Promise<void>;
  getAgentAccess(agentId: string): Promise<AgentAccess>;
  setAgentAccess(agentId: string, access: AgentAccess): Promise<void>;
  /** Agents that currently have this secret in their granted set. Empty
   *  when the secret is not granted to any agent. (ADR-040) */
  listGrantedAgents(secretId: string): Promise<GrantedAgentSummary[]>;
}
