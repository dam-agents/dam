import { z } from "zod";
import { contribution } from "agent-runtime-api";
import { secretRef, type SecretRef } from "../secret-store/types.js";
import type { ProviderPresetType } from "./providers.js";
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

export const connection = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  templateId: z.string().min(1),
  name: z.string().min(1),
  inputs: z.record(z.string(), z.unknown()),
  auth: authConfig,
  contributions: z.array(contribution),
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
  detail: z.string().optional(),
  checkedAt: z.string(),
});
export type ProviderKeyCheck = z.infer<typeof providerKeyCheck>;

export interface ProviderKeyRecheck {
  connectionId: string;
  check: ProviderKeyCheck | null;
}

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
  authKind: authKind,
  contributions: z.array(contribution),
  connectedAt: z.string().optional(),
  hosts: z.array(z.string()),
  host: z.string().min(1).optional(),
  accountLabel: z.string().min(1).optional(),
  keyCheck: providerKeyCheck.optional(),
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

export interface ProviderBalance {
  unit: "bobcoins" | "usd";
  used: number;
  limit: number | null;
  resetsAt: string | null;
}

export interface ConnectionsService {
  listTemplates(): Promise<ConnectionTemplateView[]>;

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

  validateGrantSet(connectionIds: string[]): Promise<void>;

  createFromTemplate(
    input: ConnectionCreateInput & { id?: string },
  ): Promise<string>;

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
  }): Promise<void>;

  probeGitHubUserTokenForConnection(input: {
    connectionId: string;
  }): Promise<GitHubUserTokenProbe>;

  updateGitHubUserTokenScope(input: {
    id: string;
    targetId?: number;
    repositoryIds?: string;
    permissions?: string;
  }): Promise<void>;

  startOAuth(
    connectionId: string,
    opts?: { returnTo?: string; popup?: boolean },
  ): Promise<{ authUrl: string }>;

  update(id: string, credential: ConnectionCredentialUpdate): Promise<void>;

  deleteConnection(id: string): Promise<void>;

  getAgentConnections(agentId: string): Promise<AgentConnections>;
  setAgentConnections(agentId: string, connectionIds: string[]): Promise<void>;

  updateAgentConnections(
    agentId: string,
    change: { grant: string[]; revoke: string[] },
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
  grantedAgents: { id: string; name: string }[];
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
}

export interface SecretRequestsService {
  request(input: ConnectionRequestSecretInput): Promise<SecretRequestTicket>;
  status(requestId: string): Promise<SecretRequestState>;
  get(requestId: string): Promise<SecretRequestView | null>;
  submit(input: SecretRequestSubmitInput): Promise<{ connectionId: string }>;
  cancel(requestId: string): Promise<void>;
}
