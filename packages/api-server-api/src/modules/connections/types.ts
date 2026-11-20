import { z } from "zod";
import { contribution } from "agent-runtime-api";
import { secretRef, type SecretRef } from "../secret-store/types.js";
import type { ProviderPresetType } from "./providers.js";
import type { OwnerModelCatalogView } from "../model-catalog/types.js";
import type {
  ConnectionCreateInput,
  ConnectionCredentialUpdate,
  ConnectionRequestSecretInput,
  SecretRequestSubmitInput,
} from "./schemas.js";

export const connectionCategory = z.enum(["app", "mcp", "other"]);
export type ConnectionCategory = z.infer<typeof connectionCategory>;

export const refreshBackoff = z.object({
  failures: z.number().int(),
  nextAttempt: z.number().int(),
});

export const githubUserTokenScope = z.object({
  targetId: z.number().int(),
  targetLogin: z.string().min(1).optional(),
  repositoryIds: z.array(z.number().int()).nonempty().optional(),
  repositoryNames: z.array(z.string().min(1)).optional(),
  permissions: z.record(z.string(), z.string()).optional(),
});
export type GitHubUserTokenScope = z.infer<typeof githubUserTokenScope>;

export const oauthAuth = z.object({
  kind: z.literal("oauth"),
  clientId: z.string(),
  refreshTokenRef: secretRef.optional(),
  accessTokenRef: secretRef,
  scopes: z.array(z.string()).default([]),
  tokenUrl: z.string().url(),
  authorizationUrl: z.string().url(),
  resource: z.string().url().optional(),
  requestedScopes: z.array(z.string()).optional(),
  clientSecretRef: secretRef.optional(),
  expiresAt: z.number().int().optional(),
  connectedAt: z.number().int().optional(),
  refreshFailedAt: z.number().int().optional(),
  refreshBackoff: refreshBackoff.optional(),
  tokenEndpointAcceptJson: z.boolean().optional(),
  extraAuthParams: z.record(z.string(), z.string()).optional(),
  host: z.string().min(1).optional(),
  appSlug: z.string().min(1).optional(),
  githubUserTokenScope: githubUserTokenScope.optional(),
  fullAccess: z.literal(true).optional(),
});

export const clientCredentialsAuth = z.object({
  kind: z.literal("client-credentials"),
  clientId: z.string(),
  clientSecretRef: secretRef,
  accessTokenRef: secretRef,
  issuerUrl: z.string().url(),
  tokenUrl: z.string().url(),
  scopes: z.array(z.string()).default([]),
  audience: z.string().min(1).optional(),
  expiresAt: z.number().int().optional(),
  connectedAt: z.number().int().optional(),
  refreshFailedAt: z.number().int().optional(),
  refreshBackoff: refreshBackoff.optional(),
  tokenEndpointAcceptJson: z.boolean().optional(),
  host: z.string().min(1).optional(),
});

export const githubAppAuth = z.object({
  kind: z.literal("github-app"),
  appId: z.string().min(1),
  installationId: z.string().min(1),
  privateKeyRef: secretRef,
  accessTokenRef: secretRef,
  apiBaseUrl: z.string().url(),
  expiresAt: z.number().int().optional(),
  connectedAt: z.number().int().optional(),
  refreshFailedAt: z.number().int().optional(),
  refreshBackoff: refreshBackoff.optional(),
  host: z.string().min(1).optional(),
  repositories: z.array(z.string().min(1)).nonempty().optional(),
  permissions: z.record(z.string(), z.string()).optional(),
  repositoryIds: z.array(z.number().int()).nonempty().optional(),
  fullAccess: z.literal(true).optional(),
});

export const headerAuth = z.object({
  kind: z.literal("header"),
  valueRef: secretRef,
  headerName: z.string().min(1),
  valueFormat: z.string().min(1),
});

export const sigv4Auth = z.object({
  kind: z.literal("sigv4"),
  accessKeyIdRef: secretRef,
  secretAccessKeyRef: secretRef,
  credentialsFileRef: secretRef,
  region: z.string().min(1),
  service: z.literal("s3"),
});

export const noneAuth = z.object({
  kind: z.literal("none"),
});

export const authConfig = z.discriminatedUnion("kind", [
  oauthAuth,
  clientCredentialsAuth,
  githubAppAuth,
  headerAuth,
  sigv4Auth,
  noneAuth,
]);
export type AuthConfig = z.infer<typeof authConfig>;
export type { SecretRef };

// UNIT_BOUNDARY_DESCRIPTION: what an Agent may do with the tools of an MCP Connection. `allow-all` lets every tool call through, `read-only` only the read tools, and `needs-approval` holds every tool call until someone answers it.
export const toolMode = z.enum(["allow-all", "read-only", "needs-approval"]);
export type ToolMode = z.infer<typeof toolMode>;

// UNIT_BOUNDARY_DESCRIPTION: one tool an MCP server lists. `readOnly` is the server's `readOnlyHint`, or the Template's own read list where it declares one.
export const connectionTool = z.object({
  name: z.string(),
  readOnly: z.boolean(),
});
export type ConnectionTool = z.infer<typeof connectionTool>;

// UNIT_BOUNDARY_DESCRIPTION: the tool mode an MCP Connection stores, with the tools the api-server last read from its server. `tools` is null until the first read succeeded, and `listError` says why the last read failed.
export const connectionToolAccessRecord = z.object({
  mode: toolMode,
  tools: z.array(connectionTool).nullable(),
  listedAt: z.string().nullable(),
  listError: z.string().nullable(),
});
export type ConnectionToolAccessRecord = z.infer<
  typeof connectionToolAccessRecord
>;

export const connection = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  templateId: z.string().min(1),
  name: z.string().min(1),
  inputs: z.record(z.string(), z.unknown()),
  auth: authConfig,
  contributions: z.array(contribution),
  parentId: z.string().min(1).optional(),
  isParent: z.literal(true).optional(),
  toolAccess: connectionToolAccessRecord.optional(),
});
export type Connection = z.infer<typeof connection>;

export const connectionStatus = z.enum([
  "active",
  "expired",
  "pending",
  "disconnected",
]);
export type ConnectionStatus = z.infer<typeof connectionStatus>;

export const authKind = z.enum([
  "oauth",
  "client-credentials",
  "github-app",
  "header",
  "sigv4",
  "none",
]);
export type AuthKind = z.infer<typeof authKind>;

export const providerKeyCheck = z.object({
  result: z.enum(["ok", "refused", "unverified"]),
  account: z.string().optional(),
  detail: z.string().optional(),
  checkedAt: z.string(),
});
export type ProviderKeyCheck = z.infer<typeof providerKeyCheck>;

export const credentialCheck = z.object({
  status: z.enum(["passed", "failed", "unchecked"]),
  account: z.string().optional(),
  expiresAt: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  installedOn: z.string().optional(),
  repositories: z.array(z.string()).optional(),
  repositoriesTruncated: z.boolean().optional(),
  reason: z.string().optional(),
  at: z.string(),
});
export type CredentialCheck = z.infer<typeof credentialCheck>;

export interface CredentialCheckPolicy {
  holdUnlessPassed?: boolean;
}

export interface ProviderKeyRecheck {
  connectionId: string;
  check: ProviderKeyCheck | null;
}

// UNIT_BOUNDARY_DESCRIPTION: the tool mode of an MCP Connection as its owner sees it, with the modes it offers: only `allow-all` where the gateway cannot read the Connection's requests. `defaultMode` is its Template's default, `read-only` for a Slack Account, so a client can mark a Connection that allows more than its Template does.
export const connectionToolAccess = connectionToolAccessRecord.extend({
  modes: z.array(toolMode).readonly(),
  defaultMode: toolMode,
  tools: z.array(connectionTool).readonly().nullable(),
});
export type ConnectionToolAccess = z.infer<typeof connectionToolAccess>;

// UNIT_BOUNDARY_DESCRIPTION: the tool modes a Template that makes an MCP Connection offers at connect, and the one a new Connection gets when the create names none. A Template whose MCP server has no auth offers `allow-all` alone.
export const connectionTemplateToolAccess = z.object({
  defaultMode: toolMode,
  modes: z.array(toolMode).readonly(),
});
export type ConnectionTemplateToolAccess = z.infer<
  typeof connectionTemplateToolAccess
>;

export const connectionProviderView = z.object({
  alias: z.string(),
  harnesses: z.array(z.string()),
});
export type ConnectionProviderView = z.infer<typeof connectionProviderView>;

export const connectionView = z.object({
  id: z.string(),
  ownerId: z.string(),
  templateId: z.string(),
  category: connectionCategory,
  name: z.string(),
  status: connectionStatus,
  retiredHost: z.string().min(1).optional(),
  authKind: authKind,
  contributions: z.array(contribution),
  connectedAt: z.string().optional(),
  hosts: z.array(z.string()),
  host: z.string().min(1).optional(),
  accountLabel: z.string().min(1).optional(),
  keyCheck: providerKeyCheck.optional(),
  check: credentialCheck.optional(),
  appSlug: z.string().min(1).optional(),
  hasClientSecret: z.boolean().optional(),
  githubAppScope: z
    .object({
      repositories: z.array(z.string()).optional(),
      repositoryIds: z.array(z.number().int()).optional(),
      permissions: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  githubUserToken: z
    .object({ scope: githubUserTokenScope.optional() })
    .optional(),
  parentId: z.string().optional(),
  isParent: z.literal(true).optional(),
  fullAccess: z.literal(true).optional(),
  toolAccess: connectionToolAccess.optional(),
  provider: connectionProviderView
    .extend({ preferred: z.boolean() })
    .optional(),
});
export type ConnectionView = z.infer<typeof connectionView>;

export const templateInputState = z.enum([
  "required",
  "overridable",
  "optional",
]);

export const templateInput = z.object({
  name: z.string(),
  state: templateInputState,
  presetValue: z.string().optional(),
  secret: z.boolean().optional(),
  multiline: z.boolean().optional(),
  configInput: z.boolean().optional(),
  label: z.string().optional(),
  hint: z.string().optional(),
  pattern: z.string().optional(),
  patternHint: z.string().optional(),
  enumValues: z.array(z.string()).optional(),
});
export type TemplateInput = z.infer<typeof templateInput>;

export const connectionFamilyView = z.object({
  id: z.string(),
  title: z.string(),
});

export const connectionTemplateView = z.object({
  id: z.string(),
  name: z.string(),
  category: connectionCategory,
  isCustom: z.boolean(),
  family: connectionFamilyView.optional(),
  description: z.string().optional(),
  iconSlug: z.string().optional(),
  authKind: authKind,
  inputs: z.array(templateInput),
  extras: z.record(z.string(), z.unknown()).optional(),
  toolAccess: connectionTemplateToolAccess.optional(),
  provider: connectionProviderView.optional(),
});
export type ConnectionTemplateView = z.infer<typeof connectionTemplateView>;

export const agentConnections = z.object({
  agentId: z.string(),
  connections: z.array(
    z.object({
      connectionId: z.string(),
      grantedAt: z.string(),
      preferred: z.boolean(),
      connection: connectionView.optional(),
    }),
  ),
});
export type AgentConnections = z.infer<typeof agentConnections>;

export interface ClusterCaProbe {
  reachable: boolean;
  trusted: boolean;
  error?: string;
}

export interface GitHubAppInstallationProbe {
  permissions: Record<string, string>;
  repositories: { id: number; name: string }[];
  repositorySelection: "all" | "selected";
  accountLogin?: string;
  repositoriesUnavailable?: string;
  repositoriesTruncated?: boolean;
}

export interface GitHubUserTokenInstallation extends GitHubAppInstallationProbe {
  installationId: number;
  targetId: number;
  accountLogin: string;
}

export interface GitHubUserTokenProbe {
  installations: GitHubUserTokenInstallation[];
  installationsTruncated?: boolean;
}

export interface GitHubAppInstallationAccount {
  login: string;
  targetId: number;
  kind: "organization" | "user";
  repositorySelection: "all" | "selected";
  avatarUrl?: string;
  suspended?: true;
}

export interface GitHubAppInstallations {
  accounts: GitHubAppInstallationAccount[];
  truncated?: true;
}

export interface ProviderBalance {
  unit: "bobcoins" | "usd";
  used: number;
  limit: number | null;
  resetsAt: string | null;
}

export interface ConnectionsService {
  listTemplates(): Promise<ConnectionTemplateView[]>;

  /** UNIT_BOUNDARY_DESCRIPTION: every provider Connection the owner holds, or with `agentId` only those granted to that agent. */
  modelCatalog(agentId?: string): Promise<OwnerModelCatalogView>;

  listConnections(): Promise<ConnectionView[]>;

  listAndReconcileConnections(): Promise<ConnectionView[]>;

  getConnection(id: string): Promise<ConnectionView | null>;

  validateProviderConnection(id: string): Promise<void>;

  defaultProviderConnections(
    fits: (type: ProviderPresetType, templateId: string) => boolean,
    harness?: string,
    upTo?: string,
  ): Promise<string[]>;
  getProviderBalance(id: string): Promise<ProviderBalance | null>;

  recheckProviderKeys(): Promise<ProviderKeyRecheck[]>;

  validateGrantSet(
    connectionIds: string[],
    opts?: { platform?: boolean },
  ): Promise<void>;

  createFromTemplate(
    input: ConnectionCreateInput & { id?: string },
    opts?: CredentialCheckPolicy,
    platform?: { rememberedInputs: Record<string, string> },
  ): Promise<string>;

  /* UNIT_BOUNDARY_DESCRIPTION: the Connection that lets an Agent drive this install as its owner, one per owner: minted with its key on first use, else the one the owner already holds; null where the install's own URL is not one a gateway can reach and inject on. A person's own call is refused while the install does not offer them that Connection; the platform's own provisioning carries `platform`. */
  ensureDamConnection(opts?: { platform?: boolean }): Promise<string | null>;

  /* UNIT_BOUNDARY_DESCRIPTION: mints a fresh key into that Connection, on the owner's word, keeping the Connection, its grants and every Agent's env as they are: the old key stops working at once, so this is also how a key the owner revoked in Settings is replaced. */
  rotateDamConnection(id: string): Promise<void>;

  discoverMcp(input: { url: string }): Promise<{
    auth: "oauth" | "none";
  }>;

  probeClusterCa(input: { host: string }): Promise<ClusterCaProbe>;

  probeGitHubAppInstallation(input: {
    appId: string;
    installationId: string;
    privateKey: string;
    host?: string;
    templateId: string;
  }): Promise<GitHubAppInstallationProbe>;

  probeGitHubAppInstallationForConnection(input: {
    connectionId: string;
  }): Promise<GitHubAppInstallationProbe>;

  updateGitHubAppScope(input: {
    id: string;
    repositories?: string;
    repositoryIds?: string;
    permissions?: string;
    fullAccess?: boolean;
  }): Promise<void>;

  createFromParent(input: {
    parentId: string;
    name: string;
    fullAccess?: boolean;
    targetId?: number;
    repositories?: string;
    repositoryIds?: string;
    permissions?: string;
  }): Promise<string>;

  probeGitHubUserTokenForConnection(input: {
    connectionId: string;
  }): Promise<GitHubUserTokenProbe>;

  /** UNIT_BOUNDARY_DESCRIPTION: the accounts — organizations and users — a GitHub sign-in's app is installed on, read with the sign-in's own user token; for a connection made from a sign-in, its sign-in's. */
  listGitHubAppInstallations(input: {
    connectionId: string;
  }): Promise<GitHubAppInstallations>;

  updateGitHubUserTokenScope(input: {
    id: string;
    targetId?: number;
    repositoryIds?: string;
    permissions?: string;
    fullAccess?: boolean;
  }): Promise<void>;

  /** UNIT_BOUNDARY_DESCRIPTION: sets the tool mode of an MCP Connection, one of the modes it offers. The gateway reads the mode on every tool call, so it holds from the next call with no restart. */
  setToolMode(input: { id: string; mode: ToolMode }): Promise<void>;

  /** UNIT_BOUNDARY_DESCRIPTION: reads the tool list of an MCP Connection's server again, with the Connection's own credential, and returns its tool access. A list that came back replaces the stored tools and `listedAt`; a failure keeps the old tools and says why in `listError`. Only an MCP Connection with a credential has a list to read. */
  refreshTools(input: { id: string }): Promise<ConnectionToolAccess>;

  /** UNIT_BOUNDARY_DESCRIPTION: points a GitHub Enterprise sign-in, and every connection made from it, at another host the install offers. Names, grants and scopes stay; the tokens of the old host are dropped, so the sign-in reads expired until its owner authorizes it on the new host. */
  moveToHost(input: { id: string; host: string }): Promise<void>;

  startOAuth(
    connectionId: string,
    opts?: { returnTo?: string; popup?: boolean },
  ): Promise<{ authUrl: string }>;

  update(
    id: string,
    credential: ConnectionCredentialUpdate,
    opts?: CredentialCheckPolicy,
  ): Promise<void>;

  checkCredential(id: string): Promise<CredentialCheck | null>;

  deleteConnection(id: string): Promise<void>;

  getAgentConnections(agentId: string): Promise<AgentConnections>;
  setAgentConnections(
    agentId: string,
    connectionIds: string[],
    opts?: { platform?: boolean },
  ): Promise<void>;

  updateAgentConnections(
    agentId: string,
    change: { grant: string[]; revoke: string[] },
    opts?: { platform?: boolean },
  ): Promise<void>;
  setPreferredConnection(agentId: string, connectionId: string): Promise<void>;
}

export const secretRequestStatus = z.enum([
  "pending",
  "saved",
  "cancelled",
  "expired",
]);
export type SecretRequestStatus = z.infer<typeof secretRequestStatus>;

export interface SecretRequestField {
  name: string;
  label: string;
  multiline?: boolean;
}

export interface SecretRequestDestination {
  host: string;
  port?: number;
  headerName?: string;
  valueFormat?: string;
  signed?: boolean;
}

export interface SecretRequestView {
  action: "create" | "update";
  connectionName: string;
  connectionId?: string;
  templateId: string;
  templateName: string;
  iconSlug?: string;
  authKind: AuthKind;
  destinations: SecretRequestDestination[];
  unexpectedHosts: string[];
  customDestination: boolean;
  tokenEndpoint?: { url: string } | { discoveredFrom: string };
  envNames: string[];
  isParent?: true;
  githubAppAccess?: {
    fullAccess?: true;
    repositories?: string[];
    repositoryIds?: number[];
    permissions?: Record<string, string>;
  };
  grantedAgents: { id: string; name: string }[];
  requestedBy?: { id: string; name: string };
  fields: SecretRequestField[];
  expiresAt: string;
}

export interface SecretRequestTicket {
  requestId: string;
  url: string;
  expiresAt: string;
}

export interface SecretRequestState {
  status: SecretRequestStatus;
  connectionId?: string;
  check?: CredentialCheck;
  granted?: boolean;
}

export type SecretRequestSubmitResult =
  | {
      status: "saved";
      connectionId: string;
      check?: CredentialCheck;
      granted?: boolean;
    }
  | { status: "check-not-passed"; check: CredentialCheck };

export interface SecretRequestsService {
  request(input: ConnectionRequestSecretInput): Promise<SecretRequestTicket>;
  status(requestId: string): Promise<SecretRequestState>;
  get(requestId: string): Promise<SecretRequestView | null>;
  submit(input: SecretRequestSubmitInput): Promise<SecretRequestSubmitResult>;
  cancel(requestId: string): Promise<void>;
}
