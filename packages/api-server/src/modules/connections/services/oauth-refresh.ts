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
import type { GitHubAppEngine } from "../infrastructure/github-app-engine.js";
import type { ConnectionTemplateRegistry } from "../domain/connection-template.js";
import { buildConnectionSdsFields } from "../domain/connection-sds.js";
import {
  isPermanentTokenRejection,
  tokenRejectionOf,
  withoutRefreshFailureMarker,
} from "../domain/refresh-failure-marker.js";
import { securityLog } from "../../../core/security-log.js";
import type { SecretStore } from "../../secret-store/index.js";
import { mintClientCredentialsToken } from "./client-credentials.js";
import { refreshOAuthAccessToken } from "./oauth-token.js";
import { mintGitHubAppToken } from "./github-app.js";

export interface OAuthRefreshLoop {
  /** One idempotent refresh pass — scheduled via the shared periodic-jobs
   *  queue (one execution per period across replicas). */
  tickOnce(): Promise<{ refreshed: number; failed: number; skipped: number }>;
}

interface RefreshDeps {
  db: Db;
  engine: OAuthEngine;
  githubAppEngine: GitHubAppEngine;
  templates: ConnectionTemplateRegistry;
  secretStore: SecretStore;
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
  const skewSec = deps.refreshSkewSeconds ?? 5 * 60;
  const backoffBaseMs = deps.backoffBaseMs ?? 60_000;
  const backoffMaxMs = deps.backoffMaxMs ?? 30 * 60_000;
  const now = deps.now ?? (() => Date.now());
  const log =
    deps.log ?? ((m) => process.stderr.write(`[oauth-refresh] ${m}\n`));
  let running = false;

  // Per-connection failure backoff, persisted on the connection's `auth`
  // (see `refreshBackoff` in api-server-api). A connection whose token can't
  // be refreshed (e.g. a revoked refresh token) stays in the due set on every
  // tick; without this it would be retried forever. It lives in Postgres
  // rather than in-process because the sweep runs as a periodic job on
  // whichever replica draws the tick — per-replica state would be a different
  // replica's each time, so the backoff would never actually apply. Cleared
  // by the first success — every credential write strips it via
  // `withoutRefreshFailureMarker`.

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
      for (const conn of due) {
        if (conn.auth.kind === "oauth" && !conn.auth.refreshTokenRef) continue;
        const state =
          "refreshBackoff" in conn.auth ? conn.auth.refreshBackoff : undefined;
        if (state && startedAt < state.nextAttempt * 1000) {
          skipped++;
          continue;
        }
        try {
          if (conn.auth.kind === "oauth") {
            await refreshOne(conn, conn.auth, deps);
          } else if (conn.auth.kind === "client-credentials") {
            await remintOne(conn, conn.auth, deps);
          } else if (conn.auth.kind === "github-app") {
            await remintGitHubAppOne(conn, conn.auth, deps);
          } else {
            continue;
          }
          refreshed++;
        } catch (err) {
          failed++;
          // Parked, not retried. A failed marker write falls through to the
          // backoff below, so the connection never goes quiet.
          if (
            isPermanentAuthFailure(err, conn.auth) &&
            (await markRefreshFailure(conn, err, deps, now(), log))
          ) {
            continue;
          }
          const failures = (state?.failures ?? 0) + 1;
          const delay = backoffDelayMs(failures, backoffBaseMs, backoffMaxMs);
          await recordBackoff(
            conn,
            { failures, nextAttempt: Math.floor((startedAt + delay) / 1000) },
            deps,
          );
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

  return { tickOnce: tick };
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
          "github-app",
        ]),
        // Marked connections are parked; clearing the marker re-admits them.
        sql`(${connectionsTable.auth} -> 'refreshFailedAt') IS NULL`,
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

/** Merges the backoff into `auth` server-side, guarded the same way
 *  {@link markRefreshFailure} is: a successful credential write that landed
 *  since this tick read the row bumps `expiresAt`/`connectedAt`, and must not
 *  have a stale backoff written back over it. Best-effort — a lost write only
 *  means one extra attempt next tick. */
async function recordBackoff(
  conn: Connection,
  backoff: { failures: number; nextAttempt: number },
  deps: { db: Db },
): Promise<void> {
  if (conn.auth.kind === "header" || conn.auth.kind === "none") return;
  const auth = conn.auth;
  try {
    await deps.db
      .update(connectionsTable)
      .set({
        auth: sql`jsonb_set(${connectionsTable.auth}, '{refreshBackoff}', ${JSON.stringify(backoff)}::jsonb)`,
      })
      .where(
        and(
          eq(connectionsTable.id, conn.id),
          sql`${connectionsTable.auth} ->> 'expiresAt' IS NOT DISTINCT FROM ${auth.expiresAt === undefined ? null : String(auth.expiresAt)}`,
          sql`${connectionsTable.auth} ->> 'connectedAt' IS NOT DISTINCT FROM ${auth.connectedAt === undefined ? null : String(auth.connectedAt)}`,
        ),
      );
  } catch {
    /* backoff is an optimization; a failed write costs one extra attempt */
  }
}

function isPermanentAuthFailure(
  err: unknown,
  auth: ConnectionAuthConfig,
): boolean {
  const rejection = tokenRejectionOf(err);
  if (!rejection) return false;
  return isPermanentTokenRejection({
    ...rejection,
    ownsClientSecret: ownsClientSecret(auth),
  });
}

function ownsClientSecret(auth: ConnectionAuthConfig): boolean {
  switch (auth.kind) {
    // Absent ref means the operator supplies the secret, fixed centrally.
    case "oauth":
      return auth.clientSecretRef !== undefined;
    case "client-credentials":
    case "github-app":
      return true;
    case "header":
    case "none":
      return false;
  }
}

/** Persists the marker. False when nothing was marked, so the caller falls back
 *  to the backoff rather than giving up on the connection. */
async function markRefreshFailure(
  conn: Connection,
  err: unknown,
  deps: { db: Db },
  nowMs: number,
  log: (msg: string) => void,
): Promise<boolean> {
  if (conn.auth.kind === "header" || conn.auth.kind === "none") return false;
  const auth = conn.auth;
  let markedRows: number;
  try {
    // This verdict is as old as the tick's read. Merge the one key server-side
    // rather than replacing `auth`, and only while `expiresAt`/`connectedAt`
    // still match what the tick saw — every successful credential write bumps
    // one of them, so a fix that landed since wins and this marks nothing.
    const result = await deps.db
      .update(connectionsTable)
      .set({
        auth: sql`jsonb_set(${connectionsTable.auth}, '{refreshFailedAt}', to_jsonb(${Math.floor(nowMs / 1000)}::bigint))`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(connectionsTable.id, conn.id),
          sql`${connectionsTable.auth} ->> 'expiresAt' IS NOT DISTINCT FROM ${auth.expiresAt === undefined ? null : String(auth.expiresAt)}`,
          sql`${connectionsTable.auth} ->> 'connectedAt' IS NOT DISTINCT FROM ${auth.connectedAt === undefined ? null : String(auth.connectedAt)}`,
        ),
      );
    markedRows = (result as unknown as { rowCount?: number }).rowCount ?? 0;
  } catch (writeErr) {
    log(
      `connection ${conn.id} refresh-failure marker write failed: ` +
        `${(writeErr as Error).message}`,
    );
    return false;
  }
  // A credential fix landed between the tick's read and this write — nothing
  // was marked, so nothing is parked (and there is no failure to audit).
  if (markedRows === 0) return false;
  const rejection = tokenRejectionOf(err);
  securityLog("warn", "connection.refresh_permanent_failure", {
    category: "credential",
    actor: "system:oauth-refresh",
    actorKind: "system",
    target: conn.id,
    result: "failure",
    decision: "expired",
    detail: {
      templateId: conn.templateId,
      authKind: conn.auth.kind,
      ...(rejection
        ? {
            ...(rejection.oauthError
              ? { oauthError: rejection.oauthError }
              : {}),
            ...(rejection.status !== undefined
              ? { status: rejection.status }
              : {}),
          }
        : {}),
    },
  });
  return true;
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
  const next = await refreshOAuthAccessToken({
    conn,
    auth,
    engine: deps.engine,
    templates: deps.templates,
    secretStore: deps.secretStore,
  });
  const updatedAuth: ConnectionAuthConfig = {
    ...withoutRefreshFailureMarker(auth),
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
    ...withoutRefreshFailureMarker(auth),
    expiresAt: next.expiresAt,
  };
  await deps.db
    .update(connectionsTable)
    .set({ auth: updatedAuth, updatedAt: new Date() })
    .where(eq(connectionsTable.id, conn.id));
}

// GitHub App re-mint: no refresh token — every renewal signs a fresh JWT with
// the stored private key and exchanges it for a new installation token.
export async function remintGitHubAppOne(
  conn: Connection,
  auth: Extract<ConnectionAuthConfig, { kind: "github-app" }>,
  deps: {
    githubAppEngine: GitHubAppEngine;
    secretStore: SecretStore;
    db: Db;
  },
): Promise<void> {
  const privateKeyPem = await deps.secretStore.getField(auth.privateKeyRef);
  if (!privateKeyPem) {
    throw new Error(`private key missing at ${auth.privateKeyRef.path}`);
  }

  const next = await mintGitHubAppToken(deps.githubAppEngine, {
    connectionRef: `connection:${conn.id}:${conn.templateId}`,
    auth,
    privateKeyPem,
  });

  await deps.secretStore.putFields(auth.accessTokenRef, {
    access_token: next.accessToken,
    ...buildConnectionSdsFields(conn.contributions, next.accessToken),
  });
  const updatedAuth: ConnectionAuthConfig = {
    ...withoutRefreshFailureMarker(auth),
    expiresAt: next.expiresAt,
  };
  await deps.db
    .update(connectionsTable)
    .set({ auth: updatedAuth, updatedAt: new Date() })
    .where(eq(connectionsTable.id, conn.id));
}
