export type SecretType = "anthropic" | "generic";

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
