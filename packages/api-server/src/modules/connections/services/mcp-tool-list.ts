import { match } from "ts-pattern";
import type { Connection, ConnectionToolAccessRecord } from "api-server-api";
import type { SecretStore } from "../../secret-store/index.js";
import type { XactLock } from "../../../core/xact-lock.js";
import { securityLog } from "../../../core/security-log.js";
import type { ConnectionsRepository } from "../infrastructure/connections-repository.js";
import type { OAuthEngine } from "../infrastructure/oauth-engine.js";
import type { GitHubAppEngine } from "../infrastructure/github-app-engine.js";
import type { ConnectionTemplateRegistry } from "../domain/connection-template.js";
import {
  mcpServerOf,
  storedToolsOf,
  toolModeOf,
  type McpServer,
  type McpToolLister,
  type McpToolListOutcome,
} from "../domain/tool-access.js";
import { withoutParentScope } from "../domain/github-parent.js";
import { connectionRefreshLockKey } from "./oauth-refresh.js";
import { refreshOAuthAccessToken, type OAuthAuth } from "./oauth-token.js";
import { mintUnderLock, renewedAuth } from "./credential-writer.js";

const EXPIRY_SKEW_SECONDS = 60;

export interface McpToolList {
  read(conn: Connection): Promise<ConnectionToolAccessRecord | null>;
}

// UNIT_BOUNDARY_DESCRIPTION: reads the tool list of an MCP Connection's server with the Connection's own credential, and stores it on the Connection. The gate never sees the server's answer and the agent cannot be trusted to report it, so the api-server asks the server itself. A list that came back replaces the stored tools and sets `listedAt`; a failure keeps the old tools and stores a short reason in `listError`. Where the Template declares its own read list, that list decides which stored tools read. An OAuth token about to expire is refreshed first, under the Connection's refresh lock. The tools are written under the same lock, so a mode set meanwhile is kept. Null means the Connection has no MCP server the gateway reads, or is gone.
export function createMcpToolList(deps: {
  lister: McpToolLister;
  repo: Pick<
    ConnectionsRepository,
    "get" | "getById" | "updateAuth" | "updateToolAccess" | "listChildren"
  >;
  templates: ConnectionTemplateRegistry;
  secretStore: SecretStore;
  connectionLock: XactLock;
  engine: OAuthEngine;
  githubAppEngine: GitHubAppEngine;
  now?: () => number;
}): McpToolList {
  const now = deps.now ?? (() => Date.now());

  async function oauthToken(
    conn: Connection,
    auth: OAuthAuth,
  ): Promise<string | null> {
    const expiring =
      auth.expiresAt !== undefined &&
      auth.expiresAt <= now() / 1000 + EXPIRY_SKEW_SECONDS;
    if (expiring && auth.refreshTokenRef) {
      await mintUnderLock(
        conn,
        auth,
        {
          repo: deps.repo,
          secretStore: deps.secretStore,
          connectionLock: deps.connectionLock,
          lockKey: connectionRefreshLockKey(conn.id),
        },
        async (fresh, freshAuth) => {
          const next = await refreshOAuthAccessToken({
            conn: fresh,
            auth: freshAuth,
            engine: deps.engine,
            githubAppEngine: deps.githubAppEngine,
            templates: deps.templates,
            secretStore: deps.secretStore,
            children: deps.repo,
          });
          return renewedAuth(
            withoutParentScope(fresh, freshAuth),
            next.expiresAt,
          );
        },
      );
    }
    return deps.secretStore.getField(auth.accessTokenRef);
  }

  async function credentialOf(conn: Connection): Promise<string | null> {
    return match(conn.auth)
      .with({ kind: "header" }, (auth) =>
        deps.secretStore.getField(auth.valueRef),
      )
      .with({ kind: "oauth" }, (auth) => oauthToken(conn, auth))
      .with({ kind: "client-credentials" }, { kind: "github-app" }, (auth) =>
        deps.secretStore.getField(auth.accessTokenRef),
      )
      .with({ kind: "sigv4" }, { kind: "none" }, async () => null)
      .exhaustive();
  }

  async function listed(
    conn: Connection,
    server: McpServer,
  ): Promise<McpToolListOutcome> {
    const credential = await credentialOf(conn);
    if (!credential)
      return {
        ok: false,
        reason: "the connection has no credential yet: authorize it first",
      };
    return deps.lister.list(new URL(server.url), {
      [server.headerName]: server.valueFormat.replaceAll("{value}", credential),
    });
  }

  return {
    async read(conn) {
      const server = mcpServerOf(conn);
      if (!server) return null;
      const outcome = await listed(conn, server).catch(
        (err): McpToolListOutcome => ({
          ok: false,
          reason:
            err instanceof Error
              ? err.message.slice(0, 200)
              : "the tool list could not be read",
        }),
      );
      const template = deps.templates.get(conn.templateId);
      const stored = await deps.connectionLock(
        connectionRefreshLockKey(conn.id),
        async () => {
          const fresh = await deps.repo.get(conn.id, conn.ownerId);
          if (!fresh) return null;
          const before: ConnectionToolAccessRecord = fresh.toolAccess ?? {
            mode: toolModeOf(fresh, template),
            tools: null,
            listedAt: null,
            listError: null,
          };
          const next: ConnectionToolAccessRecord = outcome.ok
            ? {
                ...before,
                tools: storedToolsOf(outcome.tools, template),
                listedAt: new Date(now()).toISOString(),
                listError: null,
              }
            : { ...before, listError: outcome.reason };
          await deps.repo.updateToolAccess(conn.id, next);
          return next;
        },
      );
      securityLog(outcome.ok ? "info" : "warn", "connection.tools_list", {
        category: "credential",
        actor: conn.ownerId,
        actorKind: "user",
        target: conn.id,
        result: outcome.ok ? "success" : "failure",
        ...(outcome.ok ? {} : { reason: outcome.reason }),
        detail: {
          templateId: conn.templateId,
          ...(outcome.ok ? { tools: outcome.tools.length } : {}),
        },
      });
      return stored;
    },
  };
}
