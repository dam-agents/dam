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
import { gitHubAppMintLockKey, mintGitHubAppToken } from "./github-app.js";
import { createXactLock, type XactLock } from "../../../core/xact-lock.js";

export interface OAuthRefreshLoop {
  tickOnce(): Promise<{ refreshed: number; failed: number; skipped: number }>;
}

interface RefreshDeps {
  db: Db;
  engine: OAuthEngine;
  githubAppEngine: GitHubAppEngine;
  templates: ConnectionTemplateRegistry;
  secretStore: SecretStore;
  connectionLock?: XactLock;
  refreshSkewSeconds?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  now?: () => number;
  log?: (msg: string) => void;
}

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
  } catch {}
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

export function connectionRefreshLockKey(connectionId: string): string {
  return `connection:refresh:${connectionId}`;
}

async function refreshOne(
  conn: Connection,
  auth: Extract<ConnectionAuthConfig, { kind: "oauth" }>,
  deps: {
    engine: OAuthEngine;
    templates: ConnectionTemplateRegistry;
    secretStore: SecretStore;
    db: Db;
    connectionLock?: XactLock;
  },
): Promise<void> {
  const withLock = deps.connectionLock ?? createXactLock(deps.db);
  await withLock(connectionRefreshLockKey(conn.id), async () => {
    const fresh = await readConnection(deps.db, conn.id);
    if (
      !fresh ||
      fresh.auth.kind !== "oauth" ||
      fresh.auth.expiresAt !== auth.expiresAt
    ) {
      return;
    }
    const next = await refreshOAuthAccessToken({
      conn: fresh,
      auth: fresh.auth,
      engine: deps.engine,
      templates: deps.templates,
      secretStore: deps.secretStore,
    });
    await writeAuth(deps.db, conn.id, {
      ...withoutRefreshFailureMarker(fresh.auth),
      expiresAt: next.expiresAt,
    });
  });
}

export async function remintOne(
  conn: Connection,
  auth: Extract<ConnectionAuthConfig, { kind: "client-credentials" }>,
  deps: {
    engine: OAuthEngine;
    secretStore: SecretStore;
    db: Db;
    connectionLock?: XactLock;
  },
): Promise<void> {
  const withLock = deps.connectionLock ?? createXactLock(deps.db);
  await withLock(connectionRefreshLockKey(conn.id), async () => {
    const fresh = await readConnection(deps.db, conn.id);
    if (
      !fresh ||
      fresh.auth.kind !== "client-credentials" ||
      fresh.auth.expiresAt !== auth.expiresAt
    ) {
      return;
    }
    const clientSecret = await deps.secretStore.getField(
      fresh.auth.clientSecretRef,
    );
    if (!clientSecret) {
      throw new Error(
        `client secret missing at ${fresh.auth.clientSecretRef.path}`,
      );
    }

    const next = await mintClientCredentialsToken(deps.engine, {
      connectionRef: `connection:${conn.id}:${conn.templateId}`,
      auth: fresh.auth,
      clientSecret,
    });

    await deps.secretStore.putFields(fresh.auth.accessTokenRef, {
      access_token: next.accessToken,
      ...buildConnectionSdsFields(fresh.contributions, next.accessToken),
    });
    await writeAuth(deps.db, conn.id, {
      ...withoutRefreshFailureMarker(fresh.auth),
      expiresAt: next.expiresAt,
    });
  });
}

async function writeAuth(
  db: Db,
  connectionId: string,
  auth: ConnectionAuthConfig,
): Promise<void> {
  await db
    .update(connectionsTable)
    .set({ auth, updatedAt: new Date() })
    .where(eq(connectionsTable.id, connectionId));
}

export async function remintGitHubAppOne(
  conn: Connection,
  auth: Extract<ConnectionAuthConfig, { kind: "github-app" }>,
  deps: {
    githubAppEngine: GitHubAppEngine;
    secretStore: SecretStore;
    db: Db;
    connectionLock?: XactLock;
  },
): Promise<void> {
  const withLock = deps.connectionLock ?? createXactLock(deps.db);

  await withLock(gitHubAppMintLockKey(conn.id), async () => {
    const fresh = await readConnection(deps.db, conn.id);
    if (
      !fresh ||
      fresh.auth.kind !== "github-app" ||
      fresh.auth.expiresAt !== auth.expiresAt
    ) {
      return;
    }
    const privateKeyPem = await deps.secretStore.getField(
      fresh.auth.privateKeyRef,
    );
    if (!privateKeyPem) {
      throw new Error(
        `private key missing at ${fresh.auth.privateKeyRef.path}`,
      );
    }

    const next = await mintGitHubAppToken(deps.githubAppEngine, {
      connectionRef: `connection:${conn.id}:${conn.templateId}`,
      auth: fresh.auth,
      privateKeyPem,
    });

    await deps.secretStore.putFields(fresh.auth.accessTokenRef, {
      access_token: next.accessToken,
      ...buildConnectionSdsFields(fresh.contributions, next.accessToken),
    });

    await deps.db
      .update(connectionsTable)
      .set({
        auth: sql`jsonb_set(${connectionsTable.auth}, '{expiresAt}', to_jsonb(${next.expiresAt}::bigint)) - 'refreshFailedAt'`,
        updatedAt: new Date(),
      })
      .where(eq(connectionsTable.id, conn.id));
  });
}

async function readConnection(db: Db, id: string): Promise<Connection | null> {
  const rows = (await db
    .select()
    .from(connectionsTable)
    .where(eq(connectionsTable.id, id))) as {
    id: string;
    owner: string;
    templateId: string;
    name: string;
    inputs: unknown;
    auth: unknown;
    contributions: unknown;
  }[];
  return rows[0] ? parseRow(rows[0]) : null;
}
