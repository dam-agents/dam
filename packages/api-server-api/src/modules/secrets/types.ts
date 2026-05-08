export type SecretType = "anthropic" | "ibm-litellm" | "generic";

/** Provider preset secret types — `SecretType`s that carry a fixed host
 *  pattern + canonical env-var bundle and render in the Providers view. */
export const PROVIDER_PRESET_TYPES = ["anthropic", "ibm-litellm"] as const;
export type ProviderPresetType = (typeof PROVIDER_PRESET_TYPES)[number];

export function isProviderPresetType(type: SecretType): type is ProviderPresetType {
  return (PROVIDER_PRESET_TYPES as readonly SecretType[]).includes(type);
}

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

/**
 * OAuth-token mode. The Claude Code SDK sends `CLAUDE_CODE_OAUTH_TOKEN` via
 * `Authorization: Bearer …`, which the Envoy sidecar's credential_injector
 * filter rewrites to the stored OAuth credential on the wire.
 */
export const ANTHROPIC_OAUTH_ENV_MAPPING: EnvMapping = {
  envName: "CLAUDE_CODE_OAUTH_TOKEN",
  placeholder: DEFAULT_ENV_PLACEHOLDER,
};

/**
 * How the Envoy sidecar injects a generic secret into matching outbound
 * requests. `valueFormat` may reference the literal token `{value}`;
 * defaults to `{value}` when omitted.
 */
export interface InjectionConfig {
  headerName: string;
  valueFormat?: string;
}

/** Default used when the user doesn't override it: `Authorization: Bearer <value>`. */
export const DEFAULT_INJECTION_CONFIG: InjectionConfig = {
  headerName: "Authorization",
  valueFormat: "Bearer {value}",
};

/**
 * API-key mode. Tools that read `ANTHROPIC_API_KEY` (e.g. `@anthropic-ai/sdk`)
 * send the sentinel via `x-api-key`, which the Envoy sidecar's
 * credential_injector filter rewrites to the stored api-key credential on
 * the wire.
 */
export const ANTHROPIC_API_KEY_ENV_MAPPING: EnvMapping = {
  envName: "ANTHROPIC_API_KEY",
  placeholder: DEFAULT_ENV_PLACEHOLDER,
};

/**
 * IBM LiteLLM ETE Proxy. A single endpoint that speaks both the Anthropic
 * Messages API (consumed by Claude Code via `ANTHROPIC_BASE_URL` +
 * `ANTHROPIC_AUTH_TOKEN`) and an OpenAI-compatible API (consumed by pi-agent's
 * `pi-dynamic-providers` extension via `OPENAI_PROXY_*`). One pasted token
 * configures both harnesses; Envoy injects the real Bearer on the wire.
 */
export const IBM_LITELLM_HOST_PATTERN = "ete-litellm.ai-models.vpc-int.res.ibm.com";
const IBM_LITELLM_BASE_URL = `https://${IBM_LITELLM_HOST_PATTERN}`;

/** Default model pin set shipped with the IBM LiteLLM preset. Overridable
 *  via the form's "Advanced" disclosure. */
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

/** Builds the full env-var bundle for an IBM LiteLLM secret. Mints 13
 *  EnvMapping entries: 1 credential placeholder, 1 endpoint pin, 2 behavior
 *  flags, 5 Claude Code model pins, 4 pi-agent `openai-proxy` SPECS overrides
 *  (`pi-dynamic-providers/index.ts`). */
export function ibmLitellmEnvMappings(pins: IbmLitellmModelPins = IBM_LITELLM_DEFAULT_MODEL_PINS): EnvMapping[] {
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

/** Reverse map: extract user-facing model pins from a stored env-mapping
 *  set so the edit form can pre-populate the advanced disclosure. Falls back
 *  to defaults for any pin that isn't present. */
export function ibmLitellmPinsFromEnvMappings(envMappings: readonly EnvMapping[] | undefined): IbmLitellmModelPins {
  const lookup = (name: string) => envMappings?.find((m) => m.envName === name)?.placeholder;
  return {
    opus: lookup("ANTHROPIC_DEFAULT_OPUS_MODEL") ?? IBM_LITELLM_DEFAULT_MODEL_PINS.opus,
    sonnet: lookup("ANTHROPIC_DEFAULT_SONNET_MODEL") ?? IBM_LITELLM_DEFAULT_MODEL_PINS.sonnet,
    haiku: lookup("ANTHROPIC_DEFAULT_HAIKU_MODEL") ?? IBM_LITELLM_DEFAULT_MODEL_PINS.haiku,
    subagent: lookup("CLAUDE_CODE_SUBAGENT_MODEL") ?? IBM_LITELLM_DEFAULT_MODEL_PINS.subagent,
    default: lookup("ANTHROPIC_MODEL") ?? IBM_LITELLM_DEFAULT_MODEL_PINS.default,
  };
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

/** Minimal agent shape returned by `listGrantedAgents` — used by the UI's
 *  env-affecting edit confirmation to show which agents will roll. */
export interface GrantedAgentSummary {
  id: string;
  name: string;
}

export interface SecretsService {
  list(): Promise<SecretView[]>;
  create(input: CreateSecretInput): Promise<SecretView>;
  update(input: UpdateSecretInput): Promise<void>;
  delete(id: string): Promise<void>;
  getAgentAccess(agentId: string): Promise<AgentAccess>;
  setAgentAccess(agentId: string, access: AgentAccess): Promise<void>;
  /** Agents that currently have this secret in their granted set. Empty
   *  when the secret is not granted to any agent. (ADR-040) */
  listGrantedAgents(secretId: string): Promise<GrantedAgentSummary[]>;
}
