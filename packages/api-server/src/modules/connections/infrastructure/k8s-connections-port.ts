/**
 * OAuth credential storage: one K8s Secret per `(owner, connection)`,
 * carrying N host injections. The controller's Envoy renderer lists by
 * `owner` + `managed-by=api-server` and fans the Secret into N chains.
 *
 * Each Secret carries: one `host-<sha8>.sds.yaml` per host (Envoy
 * reads), `raw_access_token` + `refresh_token` + `client_id`/`client_secret`
 * (refresh loop), and the structured `injection-hosts` JSON annotation
 * driving both filter chains and the egress allowlist. Name hashes both
 * owner and connection to fit RFC 1123.
 */
import crypto from "node:crypto";
import type * as k8s from "@kubernetes/client-node";

import type { EnvMapping } from "api-server-api";

import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import {
  ConnectionHostInjection,
  encodeAccessToken,
  injectionValueFormat,
} from "../domain/host-injection.js";
import {
  injectionFileContent,
  sdsYamlContent,
} from "../../secrets/infrastructure/k8s-secrets-port.js";

const LABEL_OWNER = "agent-platform.ai/owner";
const LABEL_MANAGED_BY = "agent-platform.ai/managed-by";
const LABEL_SECRET_TYPE = "agent-platform.ai/secret-type";
const LABEL_CONNECTION = "agent-platform.ai/connection";

// Comma host list — `kubectl` convenience; structured form below is
// authoritative.
const ANN_HOST_PATTERNS = "agent-platform.ai/host-patterns";
// JSON list of `ConnectionHostInjection`. Drives Envoy chains + egress.
const ANN_INJECTION_HOSTS = "agent-platform.ai/injection-hosts";
const ANN_EXPIRES_AT = "agent-platform.ai/expires-at";
const ANN_TOKEN_URL = "agent-platform.ai/token-url";
const ANN_AUTHORIZATION_URL = "agent-platform.ai/authorization-url";
const ANN_GRANT_TYPE = "agent-platform.ai/grant-type";
const ANN_CONNECTION_STATUS = "agent-platform.ai/connection-status";
const ANN_CONNECTED_AT = "agent-platform.ai/connected-at";
const ANN_DISPLAY_NAME = "agent-platform.ai/display-name";
const ANN_SCOPES = "agent-platform.ai/scopes";
const ANN_APP_SLUG = "agent-platform.ai/app-slug";
// JSON list of `{envName, placeholder}` the controller materialises as
// pod env vars on every agent granted this connection. Declarative
// replacement for the controller's hardcoded github-host switch.
const ANN_ENV_MAPPINGS = "agent-platform.ai/env-mappings";
// Schema version stamped on every connection Secret. Bump on every
// breaking change so future migrations can branch on it.
const ANN_SCHEMA_VERSION = "agent-platform.ai/schema-version";
export const CONNECTION_SCHEMA_VERSION = "2";

const SECRET_TYPE_CONNECTION = "connection";
const NAME_PREFIX = "platform-conn-";

export type ConnectionStatus = "active" | "expired";
export type GrantType = "authorization_code" | "client_credentials";

export interface ConnectionTokens {
  accessToken: string;
  refreshToken?: string;
  /** Unix seconds. Absent when the provider didn't return `expires_in`. */
  expiresAt?: number;
}

export interface ConnectionMetadata {
  /**
   * Hosts this connection injects on. Non-empty; first is the identity
   * host. One SDS file + one filter chain + one egress rule per entry.
   */
  hosts: readonly ConnectionHostInjection[];
  tokenUrl: string;
  /** Authorization endpoint — needed when reconnecting from a stored
   *  connection (e.g. Generic apps where the URLs are user-supplied). */
  authorizationUrl?: string;
  clientId: string;
  clientSecret?: string;
  grantType: GrantType;
  /**
   * Optional human-readable label set by the connect flow. Generic apps
   * supply one through their connect form; static apps fall through to
   * the descriptor's displayName when empty.
   */
  displayName?: string;
  /** Comma-separated scopes — surfaced for diagnostics. Optional. */
  scopes?: string;
  /**
   * GitHub App slug — set when the connection's credentials belong to a
   * GitHub App. Surfaced on the connections list so the UI can offer an
   * "Install" / "Manage installation" action linking to
   * https://github.com/apps/{slug}/installations/new.
   */
  appSlug?: string;
  /**
   * Pod env vars to add when this connection is granted (`GH_TOKEN`,
   * `GH_HOST`, …). Sourced from the OAuth descriptor's `flow.envMappings`;
   * the controller reads them via the `env-mappings` annotation and emits
   * one corev1.EnvVar per entry. Declarative replacement for the
   * controller's hardcoded github-host switch.
   */
  envMappings?: readonly EnvMapping[];
}

export interface ConnectionSummary {
  /** Stable per-owner identifier — usually the upstream hostname. */
  connection: string;
  /** Hostnames this connection injects on, in declared order. */
  hosts: string[];
  status: ConnectionStatus;
  expiresAt?: number;
  connectedAt?: string;
  displayName?: string;
  /** GitHub App slug — only set when the connection's credentials belong
   *  to a GitHub App. See `ConnectionMetadata.appSlug`. */
  appSlug?: string;
}

export interface ConnectionRecord {
  connection: string;
  tokens: ConnectionTokens;
  metadata: ConnectionMetadata;
  status: ConnectionStatus;
  connectedAt?: string;
}

/** Cross-owner descriptor used by the refresh loop. */
export interface ConnectionWorkItem {
  /** K8s Secret name. */
  name: string;
  owner: string;
  connection: string;
  status: ConnectionStatus;
  /** Unix seconds. */
  expiresAt?: number;
  grantType: GrantType;
}

export interface K8sConnectionsPort {
  upsertConnection(input: {
    connection: string;
    tokens: ConnectionTokens;
    metadata: ConnectionMetadata;
  }): Promise<void>;
  listConnections(): Promise<ConnectionSummary[]>;
  getConnection(connection: string): Promise<ConnectionRecord | null>;
  deleteConnection(connection: string): Promise<void>;
}

function shortHash(input: string, len = 16): string {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, len);
}

export function connectionSecretName(
  owner: string,
  connection: string,
): string {
  return `${NAME_PREFIX}${shortHash(owner)}-${shortHash(connection)}`;
}

/**
 * Per-host SDS file key inside the Secret. 8-char SHA prefix is stable
 * across reconnects; must match the controller's `sdsFileKeyForHost`.
 */
export function sdsFileKeyForHost(host: string): string {
  return `host-${shortHash(host, 8)}.sds.yaml`;
}

function buildAnnotations(
  metadata: ConnectionMetadata,
  tokens: ConnectionTokens,
  status: ConnectionStatus,
  connectedAt: string,
): Record<string, string> {
  const hostsList = metadata.hosts.map((h) => h.host).join(",");
  const ann: Record<string, string> = {
    [ANN_SCHEMA_VERSION]: CONNECTION_SCHEMA_VERSION,
    [ANN_HOST_PATTERNS]: hostsList,
    [ANN_INJECTION_HOSTS]: JSON.stringify(metadata.hosts),
    [ANN_TOKEN_URL]: metadata.tokenUrl,
    [ANN_GRANT_TYPE]: metadata.grantType,
    [ANN_CONNECTION_STATUS]: status,
    [ANN_CONNECTED_AT]: connectedAt,
  };
  if (metadata.authorizationUrl)
    ann[ANN_AUTHORIZATION_URL] = metadata.authorizationUrl;
  if (metadata.displayName) ann[ANN_DISPLAY_NAME] = metadata.displayName;
  if (metadata.scopes) ann[ANN_SCOPES] = metadata.scopes;
  if (metadata.appSlug) ann[ANN_APP_SLUG] = metadata.appSlug;
  if (metadata.envMappings?.length) {
    ann[ANN_ENV_MAPPINGS] = JSON.stringify(metadata.envMappings);
  }
  if (tokens.expiresAt != null) ann[ANN_EXPIRES_AT] = String(tokens.expiresAt);
  return ann;
}

/**
 * Render the Secret's data block. One `host-<sha8>.sds.yaml` per host
 * with valueFormat pre-substituted (envoyproxy/envoy#37001 — no upstream
 * prefix template). Raw token + refresh metadata alongside.
 */
function buildStringData(
  metadata: ConnectionMetadata,
  tokens: ConnectionTokens,
): Record<string, string> {
  const data: Record<string, string> = {
    raw_access_token: tokens.accessToken,
    client_id: metadata.clientId,
  };
  for (const h of metadata.hosts) {
    const encoded = encodeAccessToken(tokens.accessToken, h.encoding);
    const valueFormat = injectionValueFormat(h);
    data[sdsFileKeyForHost(h.host)] = sdsYamlContent(
      injectionFileContent(encoded, valueFormat),
    );
  }
  if (tokens.refreshToken) data.refresh_token = tokens.refreshToken;
  if (metadata.clientSecret) data.client_secret = metadata.clientSecret;
  return data;
}

function decodeData(secret: k8s.V1Secret, key: string): string | undefined {
  const raw = secret.data?.[key];
  if (!raw) return undefined;
  return Buffer.from(raw, "base64").toString("utf8");
}

function parseHosts(raw: string | undefined): ConnectionHostInjection[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    // Defend against malformed entries so one bad row doesn't poison the
    // whole connection.
    const out: ConnectionHostInjection[] = [];
    for (const entry of parsed) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof (entry as { host?: unknown }).host === "string"
      ) {
        out.push(entry as ConnectionHostInjection);
      }
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function readSummary(secret: k8s.V1Secret): ConnectionSummary | null {
  const labels = secret.metadata?.labels ?? {};
  const ann = secret.metadata?.annotations ?? {};
  const connection = labels[LABEL_CONNECTION];
  if (!connection) return null;
  const hosts = parseHosts(ann[ANN_INJECTION_HOSTS]);
  if (!hosts) return null;
  const status: ConnectionStatus =
    ann[ANN_CONNECTION_STATUS] === "expired" ? "expired" : "active";
  const summary: ConnectionSummary = {
    connection,
    hosts: hosts.map((h) => h.host),
    status,
  };
  const expiresAt = ann[ANN_EXPIRES_AT];
  if (expiresAt) {
    const n = Number(expiresAt);
    if (Number.isFinite(n)) summary.expiresAt = n;
  }
  if (ann[ANN_CONNECTED_AT]) summary.connectedAt = ann[ANN_CONNECTED_AT];
  if (ann[ANN_DISPLAY_NAME]) summary.displayName = ann[ANN_DISPLAY_NAME];
  if (ann[ANN_APP_SLUG]) summary.appSlug = ann[ANN_APP_SLUG];
  return summary;
}

function readRecord(secret: k8s.V1Secret): ConnectionRecord | null {
  const summary = readSummary(secret);
  if (!summary) return null;
  const ann = secret.metadata?.annotations ?? {};
  const accessToken = decodeData(secret, "raw_access_token");
  if (!accessToken) return null;
  const tokens: ConnectionTokens = { accessToken };
  const refreshToken = decodeData(secret, "refresh_token");
  if (refreshToken) tokens.refreshToken = refreshToken;
  if (summary.expiresAt != null) tokens.expiresAt = summary.expiresAt;
  // Re-parse the structured hosts; readSummary only kept hostnames.
  const hosts = parseHosts(ann[ANN_INJECTION_HOSTS]);
  if (!hosts) return null;
  const metadata: ConnectionMetadata = {
    hosts,
    tokenUrl: ann[ANN_TOKEN_URL] ?? "",
    clientId: decodeData(secret, "client_id") ?? "",
    grantType:
      ann[ANN_GRANT_TYPE] === "client_credentials"
        ? "client_credentials"
        : "authorization_code",
  };
  if (ann[ANN_AUTHORIZATION_URL])
    metadata.authorizationUrl = ann[ANN_AUTHORIZATION_URL];
  if (summary.displayName) metadata.displayName = summary.displayName;
  if (ann[ANN_SCOPES]) metadata.scopes = ann[ANN_SCOPES];
  if (summary.appSlug) metadata.appSlug = summary.appSlug;
  if (ann[ANN_ENV_MAPPINGS]) {
    try {
      const parsed = JSON.parse(ann[ANN_ENV_MAPPINGS]) as EnvMapping[];
      if (Array.isArray(parsed) && parsed.length > 0)
        metadata.envMappings = parsed;
    } catch {
      // Bad annotation — skip; the controller is the authoritative reader.
    }
  }
  const clientSecret = decodeData(secret, "client_secret");
  if (clientSecret) metadata.clientSecret = clientSecret;
  return {
    connection: summary.connection,
    tokens,
    metadata,
    status: summary.status,
    ...(summary.connectedAt ? { connectedAt: summary.connectedAt } : {}),
  };
}

export function createK8sConnectionsPort(
  client: K8sClient,
  ownerSub: string,
): K8sConnectionsPort {
  const ownerSelector = `${LABEL_OWNER}=${ownerSub},${LABEL_MANAGED_BY}=api-server,${LABEL_SECRET_TYPE}=${SECRET_TYPE_CONNECTION}`;

  return {
    async upsertConnection({ connection, tokens, metadata }) {
      if (metadata.hosts.length === 0) {
        throw new Error(
          `connection ${connection}: metadata.hosts is empty — at least one host is required`,
        );
      }
      const name = connectionSecretName(ownerSub, connection);
      const existing = await client.getSecret(name);
      const connectedAt =
        existing?.metadata?.annotations?.[ANN_CONNECTED_AT] ??
        new Date().toISOString();
      const annotations = buildAnnotations(
        metadata,
        tokens,
        "active",
        connectedAt,
      );
      const labels = {
        [LABEL_OWNER]: ownerSub,
        [LABEL_MANAGED_BY]: "api-server",
        [LABEL_SECRET_TYPE]: SECRET_TYPE_CONNECTION,
        [LABEL_CONNECTION]: connection,
      };
      const body: k8s.V1Secret = {
        metadata: { name, labels, annotations },
        type: "Opaque",
        stringData: buildStringData(metadata, tokens),
      };
      if (existing) {
        await client.replaceSecret(name, {
          ...existing,
          metadata: { ...existing.metadata, labels, annotations },
          // Replace data outright — `data` and `stringData` interplay is messy
          // when shrinking the key set across rotations.
          data: undefined,
          stringData: body.stringData,
          type: "Opaque",
        });
      } else {
        await client.createSecret(body);
      }
    },

    async listConnections() {
      const items = await client.listSecrets(ownerSelector);
      return items
        .map(readSummary)
        .filter((s): s is ConnectionSummary => s !== null);
    },

    async getConnection(connection) {
      const name = connectionSecretName(ownerSub, connection);
      const secret = await client.getSecret(name);
      if (!secret) return null;
      // Defend against label-mismatch (e.g. someone renamed the connection
      // label after the hashed name was fixed) — the hashed name binds the
      // identity, so trust that. But still verify the owner.
      if (secret.metadata?.labels?.[LABEL_OWNER] !== ownerSub) return null;
      return readRecord(secret);
    },

    async deleteConnection(connection) {
      await client.deleteSecret(connectionSecretName(ownerSub, connection));
    },
  };
}

// ---------------------------------------------------------------------------
// Cross-owner helpers used by the refresh loop. The loop is a process-level
// service that doesn't know who the user is — it walks every connection
// Secret it can see and re-mints tokens that are about to expire.
// ---------------------------------------------------------------------------

const ALL_OWNERS_SELECTOR = `${LABEL_MANAGED_BY}=api-server,${LABEL_SECRET_TYPE}=${SECRET_TYPE_CONNECTION}`;

function readWorkItem(secret: k8s.V1Secret): ConnectionWorkItem | null {
  const labels = secret.metadata?.labels ?? {};
  const ann = secret.metadata?.annotations ?? {};
  const name = secret.metadata?.name;
  const owner = labels[LABEL_OWNER];
  const connection = labels[LABEL_CONNECTION];
  if (!name || !owner || !connection) return null;
  const status: ConnectionStatus =
    ann[ANN_CONNECTION_STATUS] === "expired" ? "expired" : "active";
  const grantType: GrantType =
    ann[ANN_GRANT_TYPE] === "client_credentials"
      ? "client_credentials"
      : "authorization_code";
  const item: ConnectionWorkItem = {
    name,
    owner,
    connection,
    status,
    grantType,
  };
  const expiresAt = ann[ANN_EXPIRES_AT];
  if (expiresAt) {
    const n = Number(expiresAt);
    if (Number.isFinite(n)) item.expiresAt = n;
  }
  return item;
}

export async function listAllConnectionWorkItems(
  client: K8sClient,
): Promise<ConnectionWorkItem[]> {
  const items = await client.listSecrets(ALL_OWNERS_SELECTOR);
  return items
    .map(readWorkItem)
    .filter((i): i is ConnectionWorkItem => i !== null);
}

export async function readConnectionForRefresh(
  client: K8sClient,
  name: string,
): Promise<{ secret: k8s.V1Secret; record: ConnectionRecord } | null> {
  const secret = await client.getSecret(name);
  if (!secret) return null;
  const record = readRecord(secret);
  if (!record) return null;
  return { secret, record };
}

/**
 * Writes a refreshed token into an existing connection Secret. Re-renders
 * every host's SDS file from the new access token — one Secret, N files,
 * one write.
 */
export async function writeRefreshedTokens(
  client: K8sClient,
  name: string,
  tokens: ConnectionTokens,
  metadata: ConnectionMetadata,
): Promise<void> {
  const existing = await client.getSecret(name);
  if (!existing) return;
  const ann = { ...(existing.metadata?.annotations ?? {}) };
  if (tokens.expiresAt != null) {
    ann[ANN_EXPIRES_AT] = String(tokens.expiresAt);
  } else {
    delete ann[ANN_EXPIRES_AT];
  }
  ann[ANN_CONNECTION_STATUS] = "active";
  await client.replaceSecret(name, {
    ...existing,
    metadata: { ...existing.metadata, annotations: ann },
    data: undefined,
    stringData: buildStringData(metadata, tokens),
    type: "Opaque",
  });
}

/**
 * Marks a connection Secret as expired so the UI can prompt the user to
 * reconnect. The Secret stays mounted (Envoy will still inject the now-stale
 * token); the user-visible signal lives on the connection-status annotation
 * the api-server reads when listing connections.
 */
export async function markConnectionExpired(
  client: K8sClient,
  name: string,
): Promise<void> {
  const existing = await client.getSecret(name);
  if (!existing) return;
  const ann = {
    ...(existing.metadata?.annotations ?? {}),
    [ANN_CONNECTION_STATUS]: "expired",
  };
  await client.replaceSecret(name, {
    ...existing,
    metadata: { ...existing.metadata, annotations: ann },
  });
}
