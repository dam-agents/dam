import { z } from "zod";
import { contribution, type Contribution } from "agent-runtime-api";
import { secretRef, type SecretRef } from "../secret-store/types.js";

/**
 * Connections, Connection Templates, and Contributions (ADR-051).
 *
 * One uniform shape replaces the parallel OAuth-app + provider-preset
 * registries. Every external integration is a Connection, instantiated from
 * a code-declared Connection Template, emitting a typed Contribution[] set
 * when granted to an Agent.
 *
 * The wire surface here is what the UI talks to. Wire types for the
 * contributions themselves (Contribution union) live in agent-runtime-api
 * and are imported here.
 */

// ─── Display-axis classifiers — drive UI grouping (ADR-051). ──────────────

export const connectionCategory = z.enum(["app", "mcp", "other"]);
export type ConnectionCategory = z.infer<typeof connectionCategory>;

// ─── Auth modes ───────────────────────────────────────────────────────────

/**
 * OAuth auth — Authorization-Code or Client-Credentials. The Connection
 * stores the static OAuth client identity here; access + refresh tokens
 * live behind SecretRefs so the actual bytes can be swapped to Vault
 * later without changing this shape.
 */
export const oauthAuth = z.object({
  kind: z.literal("oauth"),
  clientId: z.string(),
  /** Optional — Client-Credentials flows don't need it. */
  refreshTokenRef: secretRef.optional(),
  accessTokenRef: secretRef,
  scopes: z.array(z.string()).default([]),
  tokenUrl: z.string().url().optional(),
  authorizationUrl: z.string().url().optional(),
  /** Unix seconds. Absent when the provider didn't return `expires_in`. */
  expiresAt: z.number().int().optional(),
});

/**
 * Header-injected auth — API keys, PATs, bearer tokens, basic auth.
 * `headerName` + `valueFormat` distinguish variants of the same shape
 * (e.g. `Authorization: Bearer {value}` vs `X-API-Key: {value}`).
 */
export const headerAuth = z.object({
  kind: z.literal("header"),
  valueRef: secretRef,
  headerName: z.string().min(1),
  /** Format string with `{value}` placeholder, e.g. `"Bearer {value}"`. */
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

// ─── Connection records — the canonical Connection shape. ────────────────

export const connection = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  templateId: z.string().min(1),
  name: z.string().min(1),
  /** Raw user-typed inputs the template's `build()` projected from. */
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

/**
 * Listing shape exposed to the UI. Includes derived status (from auth
 * expiry / refresh-loop) and the template id so the UI can join to the
 * template catalog for branding.
 */
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
  /** Hosts the agent will reach through this Connection (derived from
   *  egress-host contributions). UI display only. */
  hosts: z.array(z.string()),
});
export type ConnectionView = z.infer<typeof connectionView>;

// ─── Connection Template catalog (read-only from the UI). ────────────────

export const connectionTemplateView = z.object({
  id: z.string(),
  name: z.string(),
  category: connectionCategory,
  /** `true` for templates that exist solely to drive user-typed instances
   *  (Custom MCP, Custom OAuth, Custom Header). Premade presets are
   *  `false`. */
  isCustom: z.boolean(),
  /** Short marketing text — what the integration does. */
  description: z.string().optional(),
  /** URL-safe slug for the integration's logo (UI joins to its asset map). */
  iconSlug: z.string().optional(),
  /** What auth modes the template supports — drives the input form. */
  authKinds: z.array(z.enum(["oauth", "header", "none"])),
  /** Declared by the template; UI shows as a heads-up before granting. */
  contributedKinds: z.array(z.string()),
});
export type ConnectionTemplateView = z.infer<typeof connectionTemplateView>;

// ─── Agent-side surface — which Connections a given Agent has. ───────────

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

// ─── Service contract bound on ApiContext. ────────────────────────────────

/**
 * User-facing Connections API. Operates on the new Connections model
 * (ADR-051). The old AppConnection-shaped surface is retired.
 *
 * Auth-flow concerns (start an OAuth flow, exchange a code, …) live on a
 * sibling `ConnectionsAuthService` — kept separate so the CRUD surface
 * doesn't grow with every new auth mode.
 */
export interface ConnectionsService {
  /** Catalog. Static at runtime — the template registry is code-declared. */
  listTemplates(): Promise<ConnectionTemplateView[]>;

  /** List Connections owned by the calling user. */
  listConnections(): Promise<ConnectionView[]>;

  /** Read one Connection. Returns null on not-found / not-owned. */
  getConnection(id: string): Promise<ConnectionView | null>;

  /**
   * Template-driven Connection creation. The template's `inputs` schema
   * validates `inputs`; the template's `build()` projects them to
   * `(auth, contributions, secrets)`. The Connection record + backing
   * secret(s) are written atomically. Returns the new connection id.
   */
  createFromTemplate(input: {
    templateId: string;
    name?: string;
    inputs: Record<string, unknown>;
  }): Promise<string>;

  /** Delete a Connection. Sweeps grants, contributions, and the backing
   *  secret. Idempotent. */
  deleteConnection(id: string): Promise<void>;

  /** Agent ↔ Connection grants. */
  getAgentConnections(agentId: string): Promise<AgentConnections>;
  setAgentConnections(agentId: string, connectionIds: string[]): Promise<void>;
}

// Backwards-compat exports kept for the cutover only — UI / older callers
// import these names. Will be deleted once the UI is reshaped.
export type AppConnectionStatus = ConnectionStatus;
export type AppConnectionView = ConnectionView;
export type AgentAppConnections = AgentConnections;
export { connection as connectionSchema };
