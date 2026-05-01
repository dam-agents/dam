/**
 * OAuth-issued credential storage in K8s Secrets, keyed by `(owner, connection)`.
 *
 * Replaces the OneCLI REST write path for tokens minted by the API Server's
 * OAuth callback (today: MCP servers; later: GitHub, Slack, Google). The
 * controller's Envoy renderer (`packages/controller/pkg/reconciler/envoy.go`)
 * already lists Secrets by `humr.ai/owner=<sub>,humr.ai/managed-by=api-server`,
 * so connection Secrets land in the sidecar without controller changes.
 *
 * Each Secret carries:
 *   - `sds.yaml` — SDS DiscoveryResponse the sidecar reads via `path_config_source`
 *   - `refresh_token` / `client_id` / `client_secret` — fields the refresh loop
 *      needs to mint a new access token. Only the access token is in `sds.yaml`;
 *      the refresh token never reaches the sidecar.
 *   - annotations carrying non-secret metadata (host pattern, header, expiry,
 *      token URL, grant type, status). Annotations are listable cheaply, which
 *      the refresh loop needs to find work without reading every Secret body.
 *
 * Secret naming hashes both owner and connection — owners are namespace-scoped
 * `sub` strings (often UUIDs) and connection ids are hostnames or arbitrary
 * keys, neither guaranteed to fit RFC 1123. The hash is stable and short.
 */
import crypto from "node:crypto";
import type * as k8s from "@kubernetes/client-node";

import type { K8sClient } from "../../agents/infrastructure/k8s.js";
import {
  injectionFileContent,
  sdsYamlContent,
} from "../../secrets/infrastructure/k8s-secrets-port.js";

const LABEL_OWNER = "humr.ai/owner";
const LABEL_MANAGED_BY = "humr.ai/managed-by";
const LABEL_SECRET_TYPE = "humr.ai/secret-type";
const LABEL_CONNECTION = "humr.ai/connection";

const ANN_HOST_PATTERN = "humr.ai/host-pattern";
const ANN_PATH_PATTERN = "humr.ai/path-pattern";
const ANN_HEADER_NAME = "humr.ai/injection-header-name";
const ANN_VALUE_FORMAT = "humr.ai/injection-value-format";
const ANN_EXPIRES_AT = "humr.ai/expires-at";
const ANN_TOKEN_URL = "humr.ai/token-url";
const ANN_AUTHORIZATION_URL = "humr.ai/authorization-url";
const ANN_GRANT_TYPE = "humr.ai/grant-type";
const ANN_CONNECTION_STATUS = "humr.ai/connection-status";
const ANN_CONNECTED_AT = "humr.ai/connected-at";
const ANN_DISPLAY_NAME = "humr.ai/display-name";
const ANN_SCOPES = "humr.ai/scopes";

const SECRET_TYPE_CONNECTION = "connection";
const NAME_PREFIX = "humr-conn-";

export type ConnectionStatus = "active" | "expired";
export type GrantType = "authorization_code" | "client_credentials";

export interface ConnectionTokens {
  accessToken: string;
  refreshToken?: string;
  /** Unix seconds. Absent when the provider didn't return `expires_in`. */
  expiresAt?: number;
}

export interface ConnectionMetadata {
  hostPattern: string;
  pathPattern?: string;
  headerName: string;
  valueFormat: string;
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
}

export interface ConnectionSummary {
  /** Stable per-owner identifier — usually the upstream hostname. */
  connection: string;
  hostPattern: string;
  status: ConnectionStatus;
  expiresAt?: number;
  connectedAt?: string;
  displayName?: string;
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

export function connectionSecretName(owner: string, connection: string): string {
  return `${NAME_PREFIX}${shortHash(owner)}-${shortHash(connection)}`;
}

function buildAnnotations(
  metadata: ConnectionMetadata,
  tokens: ConnectionTokens,
  status: ConnectionStatus,
  connectedAt: string,
): Record<string, string> {
  const ann: Record<string, string> = {
    [ANN_HOST_PATTERN]: metadata.hostPattern,
    [ANN_HEADER_NAME]: metadata.headerName,
    [ANN_VALUE_FORMAT]: metadata.valueFormat,
    [ANN_TOKEN_URL]: metadata.tokenUrl,
    [ANN_GRANT_TYPE]: metadata.grantType,
    [ANN_CONNECTION_STATUS]: status,
    [ANN_CONNECTED_AT]: connectedAt,
  };
  if (metadata.pathPattern) ann[ANN_PATH_PATTERN] = metadata.pathPattern;
  if (metadata.authorizationUrl) ann[ANN_AUTHORIZATION_URL] = metadata.authorizationUrl;
  if (metadata.displayName) ann[ANN_DISPLAY_NAME] = metadata.displayName;
  if (metadata.scopes) ann[ANN_SCOPES] = metadata.scopes;
  if (tokens.expiresAt != null) ann[ANN_EXPIRES_AT] = String(tokens.expiresAt);
  return ann;
}

function buildStringData(
  metadata: ConnectionMetadata,
  tokens: ConnectionTokens,
): Record<string, string> {
  const data: Record<string, string> = {
    "sds.yaml": sdsYamlContent(tokens.accessToken, metadata.valueFormat),
    access_token: injectionFileContent(tokens.accessToken, metadata.valueFormat),
    raw_access_token: tokens.accessToken,
    client_id: metadata.clientId,
  };
  if (tokens.refreshToken) data.refresh_token = tokens.refreshToken;
  if (metadata.clientSecret) data.client_secret = metadata.clientSecret;
  return data;
}

function decodeData(secret: k8s.V1Secret, key: string): string | undefined {
  const raw = secret.data?.[key];
  if (!raw) return undefined;
  return Buffer.from(raw, "base64").toString("utf8");
}

function readSummary(secret: k8s.V1Secret): ConnectionSummary | null {
  const labels = secret.metadata?.labels ?? {};
  const ann = secret.metadata?.annotations ?? {};
  const connection = labels[LABEL_CONNECTION];
  const hostPattern = ann[ANN_HOST_PATTERN];
  if (!connection || !hostPattern) return null;
  const status: ConnectionStatus =
    ann[ANN_CONNECTION_STATUS] === "expired" ? "expired" : "active";
  const summary: ConnectionSummary = { connection, hostPattern, status };
  const expiresAt = ann[ANN_EXPIRES_AT];
  if (expiresAt) {
    const n = Number(expiresAt);
    if (Number.isFinite(n)) summary.expiresAt = n;
  }
  if (ann[ANN_CONNECTED_AT]) summary.connectedAt = ann[ANN_CONNECTED_AT];
  if (ann[ANN_DISPLAY_NAME]) summary.displayName = ann[ANN_DISPLAY_NAME];
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
  const metadata: ConnectionMetadata = {
    hostPattern: summary.hostPattern,
    headerName: ann[ANN_HEADER_NAME] ?? "Authorization",
    valueFormat: ann[ANN_VALUE_FORMAT] ?? "Bearer {value}",
    tokenUrl: ann[ANN_TOKEN_URL] ?? "",
    clientId: decodeData(secret, "client_id") ?? "",
    grantType:
      ann[ANN_GRANT_TYPE] === "client_credentials"
        ? "client_credentials"
        : "authorization_code",
  };
  if (ann[ANN_PATH_PATTERN]) metadata.pathPattern = ann[ANN_PATH_PATTERN];
  if (ann[ANN_AUTHORIZATION_URL]) metadata.authorizationUrl = ann[ANN_AUTHORIZATION_URL];
  if (ann[ANN_DISPLAY_NAME]) metadata.displayName = ann[ANN_DISPLAY_NAME];
  if (ann[ANN_SCOPES]) metadata.scopes = ann[ANN_SCOPES];
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
 * Writes a new access/refresh token into an existing connection Secret
 * without touching the immutable injection metadata. Used by the refresh
 * loop after a successful token-endpoint mint.
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
