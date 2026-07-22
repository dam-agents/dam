import {
  and,
  eq,
  inArray,
  sql,
  type Db,
  connections as connectionsTable,
} from "db";
import {
  connectionAuthConfigSchema as authConfigSchema,
  contribution as contributionSchema,
  type Connection,
  type ConnectionAuthConfig,
  type Contribution,
} from "api-server-api";
import type {
  OAuthEngine,
  OAuthProvider,
} from "../infrastructure/oauth-engine.js";
import type { ConnectionTemplateRegistry } from "../domain/connection-template.js";
import { buildConnectionSdsFields } from "../domain/connection-sds.js";
import type { SecretStore } from "../../secret-store/index.js";
import { mintClientCredentialsToken } from "./client-credentials.js";

export interface OAuthRefreshLoop {
  start(): void;
  stop(): Promise<void>;
  tickOnce(): Promise<{ refreshed: number; failed: number; skipped: number }>;
}

interface RefreshDeps {
  db: Db;
  engine: OAuthEngine;
  templates: ConnectionTemplateRegistry;
  secretStore: SecretStore;
  intervalMs?: number;
  refreshSkewSeconds?: number;
  /** First-failure retry delay; doubles per consecutive failure. */
  backoffBaseMs?: number;
  /** Ceiling for the exponential retry backoff. */
  backoffMaxMs?: number;
  now?: () => number;
  log?: (msg: string) => void;
}

/**
 * Exponential backoff: `base·2^(n-1)` for the n-th consecutive failure,
 * capped at `max`. The exponent is clamped so a long-dead connection can't
 * overflow the multiplication into `NaN`.
 */
export function backoffDelayMs(
  failures: number,
  baseMs: number,
  maxMs: number,
): number {
  const exponent = Math.min(Math.max(failures - 1, 0), 30);
  return Math.min(baseMs * 2 ** exponent, maxMs);
}

export function createOAuthRefreshLoop(deps: RefreshDeps): OAuthRefreshLoop {
  const intervalMs = deps.intervalMs ?? 60_000;
  const skewSec = deps.refreshSkewSeconds ?? 5 * 60;
  const backoffBaseMs = deps.backoffBaseMs ?? 60_000;
  const backoffMaxMs = deps.backoffMaxMs ?? 30 * 60_000;
  const now = deps.now ?? (() => Date.now());
  const log =
    deps.log ?? ((m) => process.stderr.write(`[oauth-refresh] ${m}\n`));
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  // Per-connection failure backoff. A connection whose token can't be
  // refreshed (e.g. a revoked refresh token) stays in the due set on every
  // tick; without this it would be retried every `intervalMs` forever. An
  // entry is cleared on the first success and pruned once its connection
  // leaves the due set. State is in-memory — a process restart re-attempts.
  const backoff = new Map<string, { failures: number; nextAttempt: number }>();

  async function tick(): Promise<{
    refreshed: number;
    failed: number;
    skipped: number;
  }> {
    if (running) return { refreshed: 0, failed: 0, skipped: 0 };
    running = true;
    let refreshed = 0;
    let failed = 0;
    let skipped = 0;
    const startedAt = now();
    try {
      const due = await dueConnections(deps.db, skewSec);
      const dueIds = new Set(due.map((c) => c.id));
      for (const id of backoff.keys()) {
        if (!dueIds.has(id)) backoff.delete(id);
      }
      for (const conn of due) {
        if (conn.auth.kind === "oauth" && !conn.auth.refreshTokenRef) continue;
        const state = backoff.get(conn.id);
        if (state && startedAt < state.nextAttempt) {
          skipped++;
          continue;
        }
        try {
          if (conn.auth.kind === "oauth") {
            await refreshOne(conn, conn.auth, deps);
          } else if (conn.auth.kind === "client-credentials") {
            await remintOne(conn, conn.auth, deps);
          } else {
            continue;
          }
          backoff.delete(conn.id);
          refreshed++;
        } catch (err) {
          failed++;
          const failures = (state?.failures ?? 0) + 1;
          const delay = backoffDelayMs(failures, backoffBaseMs, backoffMaxMs);
          backoff.set(conn.id, { failures, nextAttempt: startedAt + delay });
          log(
            `connection ${conn.id} refresh failed (attempt ${failures}, ` +
              `retry in ${Math.round(delay / 1000)}s): ${(err as Error).message}`,
          );
        }
      }
    } finally {
      running = false;
    }
    return { refreshed, failed, skipped };
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
  const rows = (await db
    .select()
    .from(connectionsTable)
    .where(
      and(
        inArray(sql`${connectionsTable.auth} ->> 'kind'`, [
          "oauth",
          "client-credentials",
        ]),
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
  const contributions: Contribution[] = Array.isArray(row.contributions)
    ? row.contributions
        .map((c) => contributionSchema.safeParse(c))
        .flatMap((r) => (r.success ? [r.data] : []))
    : [];
  return {
    id: row.id,
    ownerId: row.owner,
    templateId: row.templateId,
    name: row.name,
    inputs: (row.inputs as Record<string, unknown>) ?? {},
    auth: auth.data,
    contributions,
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

  const sdsFields = buildConnectionSdsFields(
    conn.contributions,
    next.accessToken,
  );
  const fields: Record<string, string> = {
    access_token: next.accessToken,
    ...sdsFields,
  };
  if (next.refreshToken && auth.refreshTokenRef) {
    fields.refresh_token = next.refreshToken;
  }
  await deps.secretStore.putFields(auth.accessTokenRef, fields);
  const updatedAuth: ConnectionAuthConfig = {
    ...auth,
    expiresAt: next.expiresAt,
  };
  await deps.db
    .update(connectionsTable)
    .set({ auth: updatedAuth, updatedAt: new Date() })
    .where(eq(connectionsTable.id, conn.id));
}

// Client-credentials re-mint: no refresh token — every renewal is a fresh
// client_credentials exchange with the stored client secret.
export async function remintOne(
  conn: Connection,
  auth: Extract<ConnectionAuthConfig, { kind: "client-credentials" }>,
  deps: {
    engine: OAuthEngine;
    secretStore: SecretStore;
    db: Db;
  },
): Promise<void> {
  const clientSecret = await deps.secretStore.getField(auth.clientSecretRef);
  if (!clientSecret) {
    throw new Error(`client secret missing at ${auth.clientSecretRef.path}`);
  }

  const next = await mintClientCredentialsToken(deps.engine, {
    connectionRef: `connection:${conn.id}:${conn.templateId}`,
    auth,
    clientSecret,
  });

  await deps.secretStore.putFields(auth.accessTokenRef, {
    access_token: next.accessToken,
    ...buildConnectionSdsFields(conn.contributions, next.accessToken),
  });
  const updatedAuth: ConnectionAuthConfig = {
    ...auth,
    expiresAt: next.expiresAt,
  };
  await deps.db
    .update(connectionsTable)
    .set({ auth: updatedAuth, updatedAt: new Date() })
    .where(eq(connectionsTable.id, conn.id));
}
