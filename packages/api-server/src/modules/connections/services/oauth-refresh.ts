import { and, eq, sql, type Db, connections as connectionsTable } from "db";
import type { Connection, ConnectionAuthConfig } from "api-server-api";
import type {
  OAuthEngine,
  OAuthProvider,
} from "../infrastructure/oauth-engine.js";
import type { GitHubAppEngine } from "../infrastructure/github-app-engine.js";
import type { ConnectionTemplateRegistry } from "../domain/connection-template.js";
import {
  isPermanentTokenRejection,
  tokenRejectionOf,
} from "../domain/refresh-failure-marker.js";
import { securityLog } from "../../../core/security-log.js";
import type { SecretStore } from "../../secret-store/index.js";
import { mintClientCredentialsToken } from "./client-credentials.js";
import { refreshOAuthAccessToken } from "./oauth-token.js";
import { gitHubAppMintLockKey, mintGitHubAppToken } from "./github-app.js";
import { createXactLock, type XactLock } from "../../../core/xact-lock.js";
import { createConnectionsRepository } from "../infrastructure/connections-repository.js";
import {
  mintUnderLock,
  renewedAuth,
  writeToken,
  type CredentialWriterDeps,
} from "./credential-writer.js";

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
      const due = await createConnectionsRepository(deps.db).listDue(skewSec);
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

async function recordBackoff(
  conn: Connection,
  backoff: { failures: number; nextAttempt: number },
  deps: { db: Db },
): Promise<void> {
  if (
    conn.auth.kind === "header" ||
    conn.auth.kind === "sigv4" ||
    conn.auth.kind === "none"
  ) {
    return;
  }
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
    case "sigv4":
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
  if (
    conn.auth.kind === "header" ||
    conn.auth.kind === "sigv4" ||
    conn.auth.kind === "none"
  ) {
    return false;
  }
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

export function connectionRefreshLockKey(connectionId: string): string {
  return `connection:refresh:${connectionId}`;
}

async function refreshOne(
  conn: Connection,
  auth: Extract<ConnectionAuthConfig, { kind: "oauth" }>,
  deps: {
    engine: OAuthEngine;
    githubAppEngine: GitHubAppEngine;
    templates: ConnectionTemplateRegistry;
    secretStore: SecretStore;
    db: Db;
    connectionLock?: XactLock;
  },
): Promise<void> {
  await mintUnderLock(
    conn,
    auth,
    writerDeps(deps, connectionRefreshLockKey(conn.id)),
    async (fresh, freshAuth) => {
      const next = await refreshOAuthAccessToken({
        conn: fresh,
        auth: freshAuth,
        engine: deps.engine,
        githubAppEngine: deps.githubAppEngine,
        templates: deps.templates,
        secretStore: deps.secretStore,
      });
      return renewedAuth(freshAuth, next.expiresAt);
    },
  );
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
  await mintUnderLock(
    conn,
    auth,
    writerDeps(deps, connectionRefreshLockKey(conn.id)),
    async (fresh, freshAuth) => {
      const clientSecret = await deps.secretStore.getField(
        freshAuth.clientSecretRef,
      );
      if (!clientSecret) {
        throw new Error(
          `client secret missing at ${freshAuth.clientSecretRef.path}`,
        );
      }
      const next = await mintClientCredentialsToken(deps.engine, {
        connectionRef: `connection:${conn.id}:${conn.templateId}`,
        auth: freshAuth,
        clientSecret,
      });
      await writeToken(deps.secretStore, fresh, freshAuth, next.accessToken);
      return renewedAuth(freshAuth, next.expiresAt);
    },
  );
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
  await mintUnderLock(
    conn,
    auth,
    writerDeps(deps, gitHubAppMintLockKey(conn.id)),
    async (fresh, freshAuth) => {
      const privateKeyPem = await deps.secretStore.getField(
        freshAuth.privateKeyRef,
      );
      if (!privateKeyPem) {
        throw new Error(
          `private key missing at ${freshAuth.privateKeyRef.path}`,
        );
      }
      const next = await mintGitHubAppToken(deps.githubAppEngine, {
        connectionRef: `connection:${conn.id}:${conn.templateId}`,
        auth: freshAuth,
        privateKeyPem,
      });
      await writeToken(deps.secretStore, fresh, freshAuth, next.accessToken);
      return renewedAuth(freshAuth, next.expiresAt);
    },
  );
}

function writerDeps(
  deps: { db: Db; secretStore: SecretStore; connectionLock?: XactLock },
  lockKey: string,
): CredentialWriterDeps {
  return {
    repo: createConnectionsRepository(deps.db),
    secretStore: deps.secretStore,
    connectionLock: deps.connectionLock ?? createXactLock(deps.db),
    lockKey,
  };
}
