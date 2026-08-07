import { z } from "zod";
import { contribution, type Contribution } from "agent-runtime-api";
import { secretRef, type SecretRef } from "../secret-store/types.js";
import type { ConnectionCreateInput } from "./schemas.js";

export const connectionCategory = z.enum(["app", "mcp", "other"]);
export type ConnectionCategory = z.infer<typeof connectionCategory>;

/** Transient refresh-failure backoff. Unlike `refreshFailedAt` (a permanent
 *  rejection, which parks the connection) this only defers the next attempt,
 *  so a revoked-but-retryable credential isn't retried on every sweep tick.
 *  Persisted rather than held per-replica: the sweep runs as a periodic job on
 *  whichever replica draws the tick, so in-process state would be a different
 *  replica's each time and the backoff would never apply. Every successful
 *  token write strips it (`withoutRefreshFailureMarker`). */
export const refreshBackoff = z.object({
  failures: z.number().int(),
  /** Epoch seconds; ticks before this skip the connection. */
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
  // Epoch seconds, set only on a *permanent* token rejection: derives
  // `expired` and parks the connection. Any successful token write clears it.
  refreshFailedAt: z.number().int().optional(),
  refreshBackoff: refreshBackoff.optional(),
  tokenEndpointAcceptJson: z.boolean().optional(),
  extraAuthParams: z.record(z.string(), z.string()).optional(),
  host: z.string().min(1).optional(),
  appSlug: z.string().min(1).optional(),
});

// Client-credentials grant: the platform exchanges the stored client secret
// for short-lived access tokens (at create and again before each expiry);
// only the access token ever reaches the gateway's injection path.
// `tokenUrl` is resolved from the issuer's OAuth metadata at create time.
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

// GitHub App installation grant: the platform signs a short-lived JWT with the
// app's private key and exchanges it at GitHub for an installation access token
// (ghs_…) — at create and again before each expiry. Only the minted
// installation token ever reaches the gateway's injection path; the private key
// stays at rest in the per-Connection Secret. `apiBaseUrl` is the GitHub REST
// base the installation-token endpoint hangs off (api.github.com for github.com).
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
  // Optional narrowing of the minted token, stored because every re-mint must
  // ask for the same subset — a scope kept only on the create input would widen
  // back to the whole installation at the first renewal. Absent means the
  // installation's full authority, which is what every connection made before
  // this field existed carries.
  repositories: z.array(z.string().min(1)).nonempty().optional(),
  permissions: z.record(z.string(), z.string()).optional(),
  // Repositories named by GitHub's numeric id rather than by name — what the
  // picker records, since an id survives a rename where a name would start
  // failing at the next renewal. Only one of the two reaches GitHub; ids win
  // when both are set, and connections predating the picker carry names only.
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
  // Only for an OAuth connection storing its own client secret — an
  // operator-supplied one is deploy config, not replaceable per connection.
  hasClientSecret: z.boolean().optional(),
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
  // Renders as a multi-line textarea rather than a single-line input (e.g. a PEM private key).
  multiline: z.boolean().optional(),
  // Marks a config input the form packs into `configInputs` rather than the typed auth fields.
  configInput: z.boolean().optional(),
  label: z.string().optional(),
  hint: z.string().optional(),
  // Validation a config input declares, surfaced so clients can validate before submit (the server enforces the same).
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

/** Cluster API TLS probe. `trusted`: chains to a public root (no CA needed).
 *  `reachable && !trusted`: self-signed/private CA — user must supply it.
 *  `!reachable`: dial failed. */
export interface ClusterCaProbe {
  reachable: boolean;
  trusted: boolean;
  error?: string;
}

/** What a GitHub App installation actually grants, read back from GitHub so a
 *  user narrows by picking from what exists rather than by typing names and
 *  levels blind. `permissions` maps a permission to the level the installation
 *  holds — the ceiling for that permission, since GitHub refuses any request
 *  above it. `repositorySelection` distinguishes a fixed set of repositories
 *  from an account-wide installation, whose list is everything there is today
 *  and grows with the account. */
export interface GitHubAppInstallationProbe {
  permissions: Record<string, string>;
  repositories: { id: number; name: string }[];
  repositorySelection: "all" | "selected";
  accountLogin?: string;
  /** Why the repository list is missing, when it could not be read. Reading
   *  the grant and listing the repositories are separate calls with different
   *  authority, so the second can fail alone — leaving permission narrowing
   *  available and repository narrowing to be typed instead. */
  repositoriesUnavailable?: string;
  /** Set when the installation reaches more repositories than one probe pages
   *  through, so the list is a prefix rather than the whole set and a
   *  repository past it has to be named rather than ticked. */
  repositoriesTruncated?: boolean;
}

export interface ConnectionsService {
  listTemplates(): Promise<ConnectionTemplateView[]>;

  listConnections(): Promise<ConnectionView[]>;

  getConnection(id: string): Promise<ConnectionView | null>;

  // The optional `id` lets the secrets→connections migration supply a
  // deterministic id (derived from the legacy secret) for idempotent re-runs;
  // the router never sets it (the create schema has no `id`), so interactive
  // callers always get a random id.
  createFromTemplate(
    input: ConnectionCreateInput & { id?: string },
  ): Promise<string>;

  discoverMcp(input: { url: string }): Promise<{
    auth: "oauth" | "none";
  }>;

  // Dials a cluster API endpoint with full TLS validation and reports whether
  // its serving cert is publicly trusted, so the caller can require an explicit
  // CA paste for an untrusted endpoint rather than trusting it blindly. `host`
  // may include a `:port`. See ClusterCaProbe.
  probeClusterCa(input: { host: string }): Promise<ClusterCaProbe>;

  // Reads back what a GitHub App installation grants, so the create form can
  // offer exactly those repositories and permissions to narrow against. Needs
  // the private key because the read is authenticated as the app itself; the
  // key is used for the probe and never stored by it. See
  // GitHubAppInstallationProbe.
  probeGitHubAppInstallation(input: {
    appId: string;
    installationId: string;
    privateKey: string;
    host?: string;
    templateId: string;
  }): Promise<GitHubAppInstallationProbe>;

  startOAuth(
    connectionId: string,
    opts?: { returnTo?: string; popup?: boolean },
  ): Promise<{ authUrl: string }>;

  // Replaces the stored credential in place, preserving identity and grants.
  // `value` is the injected value (header), the client secret
  // (client-credentials/oauth), or the PEM private key (github-app). The minting
  // kinds validate first, so an invalid secret changes nothing.
  update(id: string, value: string): Promise<void>;

  deleteConnection(id: string): Promise<void>;

  getAgentConnections(agentId: string): Promise<AgentConnections>;
  setAgentConnections(agentId: string, connectionIds: string[]): Promise<void>;
}

export type AppConnectionStatus = ConnectionStatus;
export type AppConnectionView = ConnectionView;
export type AgentAppConnections = AgentConnections;
export { connection as connectionSchema };
