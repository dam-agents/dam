import { z } from "zod";
import { contribution, type Contribution } from "agent-runtime-api";
import { secretRef, type SecretRef } from "../secret-store/types.js";
import type { ConnectionCreateInput } from "./schemas.js";

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
  /** Authorization-Server endpoints. Required to drive the OAuth flow;
   *  set by the template at create time (static templates) or by the
   *  Custom MCP discovery + DCR step (dynamic templates). */
  tokenUrl: z.string().url(),
  authorizationUrl: z.string().url(),
  /** Per-Connection client_secret — set by DCR-based templates. Static
   *  templates leave this absent and supply the secret via process config
   *  on the template registry. */
  clientSecretRef: secretRef.optional(),
  /** Unix seconds. Absent when the provider didn't return `expires_in`. */
  expiresAt: z.number().int().optional(),
  /** Token-endpoint quirk: GitHub returns form-encoded unless asked for
   *  JSON. Per-provider flag the engine honors. */
  tokenEndpointAcceptJson: z.boolean().optional(),
  /** Provider-specific authorize-URL params (e.g. `allow_signup=false`). */
  extraAuthParams: z.record(z.string(), z.string()).optional(),
  /** Resolved host for host-parametrized templates (GitHub
   *  Enterprise). Surfaced back to the UI so the per-Connection card
   *  can label which deployment the connection points at. Absent for
   *  fixed-host templates. */
  host: z.string().min(1).optional(),
  /** GitHub App slug. When set, the post-authorize UI shows an
   *  "Install on GitHub" prompt linking to
   *  `https://github.com/apps/<slug>/installations/new` (or the GHE
   *  host equivalent). Carried per-Connection so the same template can
   *  yield both OAuth-App and GitHub-App connections over its lifetime. */
  appSlug: z.string().min(1).optional(),
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
  /** Resolved host for host-parametrized OAuth Connections (GitHub
   *  Enterprise). Absent for fixed-host templates. Surfaced so the UI
   *  card can label which deployment the Connection points at. */
  host: z.string().min(1).optional(),
  /** GitHub App slug — when present, the UI shows an "Install on
   *  GitHub" affordance linking to the App's installation page on
   *  the appropriate host (github.com for `template.id === "github"`,
   *  the resolved enterprise `host` for `github-enterprise`). */
  appSlug: z.string().min(1).optional(),
});
export type ConnectionView = z.infer<typeof connectionView>;

// ─── Connection Template catalog (read-only from the UI). ────────────────

export const authKind = z.enum(["oauth", "header", "none"]);
export type AuthKind = z.infer<typeof authKind>;

/**
 * Per-input state on a template view (ADR-051). Three exclusive states:
 *
 *   - `required` — no operator preset, no stored fallback. The form
 *     must collect this field; submit is gated on it being filled.
 *   - `overridable` — the operator pre-configured this field. The form
 *     hides the input behind a "Customize" toggle; if the user opts
 *     not to override, the preset is used at build time. Non-secret
 *     presets carry the value back as `presetValue`; secret presets
 *     (`clientSecret`, `value`) never echo bytes to the UI.
 *   - `optional` — no preset, no stored fallback, user may skip. The
 *     form keeps the input visible but doesn't gate submit on it.
 *     Used for fields like `appSlug` that are meaningful only for
 *     some sub-cases (GitHub App vs OAuth App).
 */
export const templateInputState = z.enum([
  "required",
  "overridable",
  "optional",
]);
export type TemplateInputState = z.infer<typeof templateInputState>;

export const templateInput = z.object({
  name: z.string(),
  state: templateInputState,
  /** Operator-supplied default for non-secret overridable fields. Only
   *  set when `state === "overridable"` AND the value isn't secret. */
  presetValue: z.string().optional(),
  /** Render as a password input — never echo the typed value. */
  secret: z.boolean().optional(),
});
export type TemplateInput = z.infer<typeof templateInput>;

/**
 * Per-template UI metadata. Each template is data, not code — one auth
 * kind per template, one place in the catalog (ADR-051). The UI uses
 * `authKind` to render the right form (auth-kind-discriminated input
 * shape); `inputs[]` carries the per-field state machine — required
 * vs overridable (operator preset) vs optional — so the form renders
 * each field in the right mode.
 */
export const connectionTemplateView = z.object({
  id: z.string(),
  name: z.string(),
  category: connectionCategory,
  /** `true` for templates the user is expected to populate themselves
   *  (Custom OAuth, Custom Header, Custom MCP). Premade presets are
   *  `false`. */
  isCustom: z.boolean(),
  /** Short marketing text — what the integration does. */
  description: z.string().optional(),
  /** URL-safe slug for the integration's logo (UI joins to its asset map). */
  iconSlug: z.string().optional(),
  /** Exactly one auth kind per template. UI form is discriminated on this. */
  authKind: authKind,
  /** Per-field state for the connect form (ADR-051). Server-computed
   *  from the template's data shape. The form renders each input
   *  according to `state` — required fields are always shown,
   *  overridable fields are hidden behind a "Customize" toggle with
   *  preset values surfaced when non-secret, optional fields are
   *  always shown but not gated. Order is render order. */
  inputs: z.array(templateInput),
  /** Opaque per-template extras the UI can probe for one-off affordances
   *  (e.g. GitHub App slug → install prompt). Off the typed schema by
   *  design — each consumer keys on what it knows. */
  extras: z.record(z.string(), z.unknown()).optional(),
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
   * Template-driven Connection creation (ADR-051). The wire input is
   * auth-kind-discriminated and fully typed; the server projects it
   * through the named template's static defaults to produce the
   * Connection's auth + contributions + backing secret. Returns the
   * new connection id.
   */
  createFromTemplate(input: ConnectionCreateInput): Promise<string>;

  /**
   * Discover an MCP server's auth shape. Lets the UI pick the right
   * template (`custom-mcp-oauth` vs `custom-mcp-none`) before submitting
   * the create. Returns `{ auth: "oauth" }` when the URL publishes
   * RFC 8414 / RFC 9728 metadata with a registration endpoint;
   * `{ auth: "none" }` otherwise.
   */
  discoverMcp(input: { url: string }): Promise<{
    auth: "oauth" | "none";
  }>;

  /**
   * Start an OAuth authorization-code flow for the given Connection.
   * Throws if the Connection's auth.kind is not `oauth`. Returns the
   * authorize URL the UI redirects to; the user finishes the dance at
   * the provider and lands back at `/api/oauth/callback`.
   */
  startOAuth(connectionId: string): Promise<{ authUrl: string }>;

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
