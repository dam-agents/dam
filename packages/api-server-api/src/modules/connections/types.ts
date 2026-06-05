import { z } from "zod";
import { contribution, type Contribution } from "agent-runtime-api";
import { secretRef, type SecretRef } from "../secret-store/types.js";
import type { ConnectionCreateInput } from "./schemas.js";

export const connectionCategory = z.enum(["app", "mcp", "other"]);
export type ConnectionCategory = z.infer<typeof connectionCategory>;

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
  tokenEndpointAcceptJson: z.boolean().optional(),
  extraAuthParams: z.record(z.string(), z.string()).optional(),
  host: z.string().min(1).optional(),
  appSlug: z.string().min(1).optional(),
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

export const connectionView = z.object({
  id: z.string(),
  ownerId: z.string(),
  templateId: z.string(),
  category: connectionCategory,
  name: z.string(),
  status: connectionStatus,
  authKind: z.enum(["oauth", "header", "none"]),
  contributions: z.array(contribution),
  connectedAt: z.string().optional(),
  hosts: z.array(z.string()),
  host: z.string().min(1).optional(),
  appSlug: z.string().min(1).optional(),
});
export type ConnectionView = z.infer<typeof connectionView>;

export const authKind = z.enum(["oauth", "header", "none"]);
export type AuthKind = z.infer<typeof authKind>;

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

export interface ConnectionsService {
  listTemplates(): Promise<ConnectionTemplateView[]>;

  listConnections(): Promise<ConnectionView[]>;

  getConnection(id: string): Promise<ConnectionView | null>;

  createFromTemplate(input: ConnectionCreateInput): Promise<string>;

  discoverMcp(input: { url: string }): Promise<{
    auth: "oauth" | "none";
  }>;

  startOAuth(
    connectionId: string,
    opts?: { returnTo?: string; popup?: boolean },
  ): Promise<{ authUrl: string }>;

  deleteConnection(id: string): Promise<void>;

  getAgentConnections(agentId: string): Promise<AgentConnections>;
  setAgentConnections(agentId: string, connectionIds: string[]): Promise<void>;
}

export type AppConnectionStatus = ConnectionStatus;
export type AppConnectionView = ConnectionView;
export type AgentAppConnections = AgentConnections;
export { connection as connectionSchema };
