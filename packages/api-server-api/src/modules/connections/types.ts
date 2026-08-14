import { z } from "zod";
import { contribution, type Contribution } from "agent-runtime-api";
import { secretRef, type SecretRef } from "../secret-store/types.js";
import type { ConnectionCreateInput } from "./schemas.js";

export const connectionCategory = z.enum(["app", "mcp", "other"]);
export type ConnectionCategory = z.infer<typeof connectionCategory>;

export const refreshBackoff = z.object({
  failures: z.number().int(),
  nextAttempt: z.number().int(),
});
export type RefreshBackoff = z.infer<typeof refreshBackoff>;

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

export const noneAuth = z.object({
  kind: z.literal("none"),
});

export const authConfig = z.discriminatedUnion("kind", [
  oauthAuth,
  clientCredentialsAuth,
  githubAppAuth,
  headerAuth,
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
  "none",
]);
export type AuthKind = z.infer<typeof authKind>;

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
  appSlug: z.string().min(1).optional(),
  hasClientSecret: z.boolean().optional(),
  githubAppScope: z
    .object({
      repositories: z.array(z.string()).optional(),
      repositoryIds: z.array(z.number().int()).optional(),
      permissions: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
});
export type ConnectionView = z.infer<typeof connectionView>;

export const templateInputState = z.enum([
  "required",
  "overridable",
  "optional",
]);
export type TemplateInputState = z.infer<typeof templateInputState>;

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

export const connectionTemplateView = z.object({
  id: z.string(),
  name: z.string(),
  category: connectionCategory,
  isCustom: z.boolean(),
  description: z.string().optional(),
  iconSlug: z.string().optional(),
  authKind: authKind,
  inputs: z.array(templateInput),
  extras: z.record(z.string(), z.unknown()).optional(),
});
export type ConnectionTemplateView = z.infer<typeof connectionTemplateView>;

export const agentConnections = z.object({
  agentId: z.string(),
  connections: z.array(
    z.object({
      connectionId: z.string(),
      grantedAt: z.string(),
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

export interface ConnectionsService {
  listTemplates(): Promise<ConnectionTemplateView[]>;

  listConnections(): Promise<ConnectionView[]>;

  getConnection(id: string): Promise<ConnectionView | null>;

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

  startOAuth(
    connectionId: string,
    opts?: { returnTo?: string; popup?: boolean },
  ): Promise<{ authUrl: string }>;

  update(id: string, value: string): Promise<void>;

  deleteConnection(id: string): Promise<void>;

  getAgentConnections(agentId: string): Promise<AgentConnections>;
  setAgentConnections(agentId: string, connectionIds: string[]): Promise<void>;
}

export type AppConnectionStatus = ConnectionStatus;
export type AppConnectionView = ConnectionView;
export type AgentAppConnections = AgentConnections;
export { connection as connectionSchema };
