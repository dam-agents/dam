import { and, eq, sql, type Db, connections as connectionsTable } from "db";
import {
  connectionAuthConfigSchema as authConfigSchema,
  type Connection,
  type ConnectionAuthConfig,
} from "api-server-api";
import type {
  OAuthEngine,
  OAuthProvider,
} from "../infrastructure/oauth-engine.js";
import type { ConnectionTemplateRegistry } from "../domain/connection-template.js";
import type { SecretStore } from "../../secret-store/index.js";

/**
 * OAuth refresh loop on top of SecretStore (ADR-051). Periodic sweep
 * across all OAuth Connections in the db; for each one whose access
 * token is about to expire (within `refreshSkewSeconds`), call the
 * token endpoint with the stored refresh token, write the new access
 * token via SecretStore.putField, update `auth.expiresAt`.
 *
 * No interaction with K8s: tokens are bytes in SecretStore, expiry is
 * a number on the Postgres row. The gateway's Envoy SDS reads the
 * SecretStore-backed file when it reloads; the refresh loop's putField
 * triggers the K8s adapter's Secret update, which kubelet propagates
 * to the mount.
 */
export interface OAuthRefreshLoop {
  start(): void;
  stop(): Promise<void>;
  /** For tests + on-demand triggers. Runs one sweep synchronously. */
  tickOnce(): Promise<{ refreshed: number; failed: number }>;
}

interface RefreshDeps {
  db: Db;
  engine: OAuthEngine;
  templates: ConnectionTemplateRegistry;
  secretStore: SecretStore;
  intervalMs?: number;
  /** Refresh tokens this many seconds before their actual expiry. */
  refreshSkewSeconds?: number;
  log?: (msg: string) => void;
}

export function createOAuthRefreshLoop(deps: RefreshDeps): OAuthRefreshLoop {
  const intervalMs = deps.intervalMs ?? 60_000;
  const skewSec = deps.refreshSkewSeconds ?? 5 * 60;
  const log =
    deps.log ?? ((m) => process.stderr.write(`[oauth-refresh] ${m}\n`));
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function tick(): Promise<{ refreshed: number; failed: number }> {
    if (running) return { refreshed: 0, failed: 0 };
    running = true;
    let refreshed = 0;
    let failed = 0;
    try {
      const due = await dueConnections(deps.db, skewSec);
      for (const conn of due) {
        if (conn.auth.kind !== "oauth") continue;
        if (!conn.auth.refreshTokenRef) continue;
        try {
          await refreshOne(conn, conn.auth, deps);
          refreshed++;
        } catch (err) {
          failed++;
          log(
            `connection ${conn.id} refresh failed: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      running = false;
    }
    return { refreshed, failed };
  }

  return {
    start(): void {
      const initial = Math.floor(Math.random() * intervalMs);
      setTimeout(() => {
        void tick();
        timer = setInterval(() => void tick(), intervalMs);
      }, initial);
    },
    async stop(): Promise<void> {
      if (timer) clearInterval(timer);
      while (running) await new Promise((r) => setTimeout(r, 50));
    },
    tickOnce: tick,
  };
}

async function dueConnections(db: Db, skewSec: number): Promise<Connection[]> {
  // expiresAt absent → never refreshed (no token yet); we skip those.
  // expiresAt - now <= skew → due for refresh.
  const rows = (await db
    .select()
    .from(connectionsTable)
    .where(
      and(
        eq(sql`${connectionsTable.auth} ->> 'kind'`, "oauth"),
        sql`
          (${connectionsTable.auth} -> 'expiresAt') IS NOT NULL
          AND ((${connectionsTable.auth} ->> 'expiresAt')::int - extract(epoch from now())::int) <= ${skewSec}
        `,
      ),
    )) as {
    id: string;
    owner: string;
    templateId: string;
    name: string;
    inputs: unknown;
    auth: unknown;
    contributions: unknown;
  }[];

  return rows
    .map((r) => parseRow(r))
    .filter((c): c is Connection => c !== null);
}

function parseRow(row: {
  id: string;
  owner: string;
  templateId: string;
  name: string;
  inputs: unknown;
  auth: unknown;
  contributions: unknown;
}): Connection | null {
  const auth = authConfigSchema.safeParse(row.auth);
  if (!auth.success) return null;
  return {
    id: row.id,
    ownerId: row.owner,
    templateId: row.templateId,
    name: row.name,
    inputs: (row.inputs as Record<string, unknown>) ?? {},
    auth: auth.data,
    contributions: [],
  };
}

async function refreshOne(
  conn: Connection,
  auth: Extract<ConnectionAuthConfig, { kind: "oauth" }>,
  deps: {
    engine: OAuthEngine;
    templates: ConnectionTemplateRegistry;
    secretStore: SecretStore;
    db: Db;
  },
): Promise<void> {
  if (!auth.refreshTokenRef) {
    throw new Error("no refresh token ref");
  }
  const refreshToken = await deps.secretStore.getField(auth.refreshTokenRef);
  if (!refreshToken) {
    throw new Error(`refresh token missing at ${auth.refreshTokenRef.path}`);
  }

  // Build provider from the connection's auth + template's operator-
  // supplied client secret (or per-Connection secret for DCR templates).
  const template = deps.templates.get(conn.templateId);
  let clientSecret =
    template && template.authKind === "oauth"
      ? template.clientSecret
      : undefined;
  if (auth.clientSecretRef) {
    const dyn = await deps.secretStore.getField(auth.clientSecretRef);
    if (dyn) clientSecret = dyn;
  }
  const provider: OAuthProvider = {
    id: `connection:${conn.id}:${conn.templateId}`,
    authorizationUrl: auth.authorizationUrl,
    tokenEndpoint: auth.tokenUrl,
    clientId: auth.clientId,
    ...(clientSecret ? { clientSecret } : {}),
    scopes: auth.scopes,
    ...(auth.tokenEndpointAcceptJson ? { tokenEndpointAcceptJson: true } : {}),
  };

  const next = await deps.engine.refresh({ provider, refreshToken });

  await deps.secretStore.putField(auth.accessTokenRef, next.accessToken);
  if (next.refreshToken && auth.refreshTokenRef) {
    // Some providers rotate refresh tokens on every refresh; honor it.
    await deps.secretStore.putField(auth.refreshTokenRef, next.refreshToken);
  }
  // Update Connection.auth.expiresAt. Read-modify-write through the
  // jsonb column.
  const updatedAuth: ConnectionAuthConfig = {
    ...auth,
    expiresAt: next.expiresAt,
  };
  await deps.db
    .update(connectionsTable)
    .set({ auth: updatedAuth, updatedAt: new Date() })
    .where(eq(connectionsTable.id, conn.id));
}
