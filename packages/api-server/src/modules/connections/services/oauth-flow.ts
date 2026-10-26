import { ZodError } from "zod";
import { TRPCError } from "@trpc/server";
import type {
  Connection,
  ConnectionAuthConfig,
  SecretRef,
} from "api-server-api";
import type { OAuthEngine } from "../infrastructure/oauth-engine.js";
import type { ConnectionsRepository } from "../infrastructure/connections-repository.js";
import type { ConnectionTemplateRegistry } from "../domain/connection-template.js";
import { buildConnectionSdsFields } from "../domain/connection-sds.js";
import { withoutRefreshFailureMarker } from "../domain/refresh-failure-marker.js";
import { applyCallbackAlias } from "../domain/oauth-callback-url.js";
import { upsertGitconfigContribution } from "../domain/gitconfig-contribution.js";
import { resolveGitHubIdentity } from "../infrastructure/github-identity.js";
import type { GitHubAppEngine } from "../infrastructure/github-app-engine.js";
import { earliestExpiry } from "../domain/github-user-token-scope.js";
import type { SecretStore } from "../../secret-store/index.js";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import type { XactLock } from "../../../core/xact-lock.js";
import { connectionRefreshLockKey } from "./oauth-refresh.js";
import { oauthProviderFor } from "./oauth-token.js";
import { scopeGitHubUserToken } from "./github-user-token.js";
import { rederiveGitHubChildren } from "./github-children.js";
import { withoutParentScope } from "../domain/github-parent.js";
import { recordAccountLabel } from "./account-label.js";
import { emit, EventType } from "../../../events.js";
import { securityLog } from "../../../core/security-log.js";

export interface OAuthFlowService {
  startOAuth(
    connectionId: string,
    opts?: { returnTo?: string; popup?: boolean },
  ): Promise<{ authUrl: string }>;
  completeOAuth(
    state: string,
    code: string,
  ): Promise<{ connectionId: string; ownerId: string }>;
}

export interface OAuthFlowPendingCtx {
  connectionId: string;
  ownerId: string;
  accessTokenRef: SecretRef;
  refreshTokenRef?: SecretRef;
  returnTo?: string;
  popup?: boolean;
}

export function createOAuthFlowService(deps: {
  engine: OAuthEngine;
  githubAppEngine: GitHubAppEngine;
  repo: ConnectionsRepository;
  templates: ConnectionTemplateRegistry;
  secretStore: SecretStore;
  runtimeMutator: RuntimeMutator;
  ownerId: string;
  callbackUrl: string;
  connectionLock: XactLock;
}): OAuthFlowService {
  return {
    async startOAuth(connectionId, opts): Promise<{ authUrl: string }> {
      const conn = await deps.repo.get(connectionId, deps.ownerId);
      if (!conn) throw new TRPCError({ code: "NOT_FOUND" });
      if (conn.auth.kind !== "oauth") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `connection auth kind is ${conn.auth.kind}; not OAuth`,
        });
      }
      if (conn.parentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This connection is renewed by the GitHub sign-in it was made from. Sign in again on the sign-in.",
        });
      }
      const provider = await oauthProviderFor({
        ...deps,
        conn,
        auth: conn.auth,
      });
      const template = deps.templates.get(conn.templateId);
      const alias =
        template?.authKind === "oauth"
          ? template.localhostCallbackAlias
          : undefined;
      const { authUrl } = await deps.engine.start<OAuthFlowPendingCtx>({
        provider,
        redirectUri: applyCallbackAlias(deps.callbackUrl, alias),
        ctx: {
          connectionId,
          ownerId: deps.ownerId,
          accessTokenRef: conn.auth.accessTokenRef,
          ...(conn.auth.refreshTokenRef
            ? { refreshTokenRef: conn.auth.refreshTokenRef }
            : {}),
          ...(opts?.returnTo ? { returnTo: opts.returnTo } : {}),
          ...(opts?.popup ? { popup: true } : {}),
        },
      });
      return { authUrl };
    },

    async completeOAuth(state, code) {
      const pending = await deps.engine.consume<OAuthFlowPendingCtx>(state);
      if (!pending) throw new Error("invalid or expired OAuth state");

      const conn = await deps.repo.get(
        pending.ctx.connectionId,
        pending.ctx.ownerId,
      );
      if (!conn) {
        throw new Error(`connection ${pending.ctx.connectionId} not found`);
      }
      if (conn.auth.kind !== "oauth") {
        throw new Error(
          `connection ${conn.id} auth kind is ${conn.auth.kind}; not OAuth`,
        );
      }

      const provider = await oauthProviderFor({
        ...deps,
        conn,
        auth: conn.auth,
      });
      const tokens = await deps.engine.exchange({ ...pending, provider }, code);

      const isReauth =
        conn.auth.kind === "oauth" &&
        (conn.auth.connectedAt !== undefined ||
          conn.auth.expiresAt !== undefined);

      await deps.connectionLock(connectionRefreshLockKey(conn.id), async () => {
        const fresh = await deps.repo.get(conn.id, pending.ctx.ownerId);
        if (!fresh || fresh.auth.kind !== "oauth") return;

        const fields: Record<string, string> = {
          access_token: tokens.accessToken,
        };
        if (tokens.refreshToken && fresh.auth.refreshTokenRef) {
          fields.refresh_token = tokens.refreshToken;
        }
        if (fresh.isParent) {
          await deps.secretStore.putFields(fresh.auth.accessTokenRef, fields);
          const expiresAt = await rederiveGitHubChildren(
            {
              repo: deps.repo,
              secretStore: deps.secretStore,
              githubAppEngine: deps.githubAppEngine,
            },
            fresh,
            tokens,
            provider.clientSecret,
          );
          await deps.repo.updateAuth(conn.id, {
            ...withoutParentScope(
              fresh,
              withoutRefreshFailureMarker(fresh.auth),
            ),
            connectedAt: Math.floor(Date.now() / 1000),
            scopes:
              tokens.scopes ?? pending.provider.scopes ?? fresh.auth.scopes,
            ...(expiresAt !== undefined ? { expiresAt } : {}),
          });
          return;
        }
        const scope = fresh.auth.githubUserTokenScope;
        await deps.secretStore.putFields(fresh.auth.accessTokenRef, {
          ...fields,
          ...(scope
            ? {}
            : buildConnectionSdsFields(
                fresh.contributions,
                tokens.accessToken,
              )),
        });
        const scoped = scope
          ? await scopeGitHubUserToken(deps.githubAppEngine, {
              connectionRef: provider.id,
              auth: fresh.auth,
              scope,
              clientSecret: provider.clientSecret,
              accessToken: tokens.accessToken,
            })
          : undefined;
        if (scoped) {
          await deps.secretStore.putFields(
            fresh.auth.accessTokenRef,
            buildConnectionSdsFields(fresh.contributions, scoped.accessToken),
          );
        }

        const expiresAt = earliestExpiry(tokens.expiresAt, scoped?.expiresAt);
        const updatedAuth: ConnectionAuthConfig = {
          ...withoutRefreshFailureMarker(fresh.auth),
          connectedAt: Math.floor(Date.now() / 1000),
          scopes: tokens.scopes ?? pending.provider.scopes ?? fresh.auth.scopes,
          ...(expiresAt !== undefined ? { expiresAt } : {}),
        };
        await deps.repo.updateAuth(conn.id, updatedAuth);
      });

      const template = deps.templates.get(conn.templateId);
      securityLog("info", "oauth.token_mint", {
        category: "credential",
        actor: pending.ctx.ownerId,
        actorKind: "user",
        target: conn.id,
        result: "success",
        detail: {
          templateId: conn.templateId,
          hasRefresh: Boolean(
            tokens.refreshToken && pending.ctx.refreshTokenRef,
          ),
          reauth: isReauth,
        },
      });
      if (!isReauth && !conn.isParent) {
        emit({
          type: EventType.ConnectionCreated,
          actorSub: pending.ctx.ownerId,
          connectionKey: conn.id,
          templateId: conn.templateId,
          kind: template?.category === "mcp" ? "mcp" : "oauth_app",
        });
      }

      const madeFrom = conn.isParent
        ? await deps.repo.listChildren(conn.id)
        : [];
      for (const each of [conn, ...madeFrom]) {
        if (template?.id === "github") {
          await applyGitHubIdentity(each, tokens.accessToken, deps);
        }
        await recordAccountLabel(each, tokens.accessToken, deps);
      }

      return {
        connectionId: pending.ctx.connectionId,
        ownerId: pending.ctx.ownerId,
      };
    },
  };
}

async function applyGitHubIdentity(
  conn: Connection,
  accessToken: string,
  deps: {
    repo: ConnectionsRepository;
    runtimeMutator: RuntimeMutator;
  },
): Promise<void> {
  try {
    const identity = await resolveGitHubIdentity(accessToken);
    const next = upsertGitconfigContribution(conn.contributions, identity);
    await deps.repo.updateContributions(conn.id, next);

    const agentIds = await deps.repo.listAgentsForConnection(conn.id);
    for (const agentId of agentIds) {
      await deps.runtimeMutator.bump(agentId, []);
      await deps.runtimeMutator.enqueueAfterCommit(agentId);
    }
  } catch (err) {
    securityLog("warn", "oauth.github_identity", {
      category: "credential",
      actor: conn.ownerId,
      actorKind: "user",
      target: conn.id,
      result: "failure",
      detail: githubIdentityErrorDetail(err),
    });
  }
}

function githubIdentityErrorDetail(err: unknown): Record<string, unknown> {
  if (err instanceof ZodError) {
    return {
      error: "ZodError",
      fields: err.issues.map((i) => i.path.join(".")),
    };
  }
  if (err instanceof Error) return { error: err.name, message: err.message };
  return { error: String(err) };
}
