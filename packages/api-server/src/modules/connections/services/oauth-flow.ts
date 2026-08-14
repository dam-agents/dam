import { ZodError } from "zod";
import type {
  Connection,
  ConnectionAuthConfig,
  SecretRef,
} from "api-server-api";
import type {
  OAuthEngine,
  OAuthProvider,
} from "../infrastructure/oauth-engine.js";
import type { ConnectionsRepository } from "../infrastructure/connections-repository.js";
import type { ConnectionTemplateRegistry } from "../domain/connection-template.js";
import { buildConnectionSdsFields } from "../domain/connection-sds.js";
import { withoutRefreshFailureMarker } from "../domain/refresh-failure-marker.js";
import { applyCallbackAlias } from "../domain/oauth-callback-url.js";
import { upsertGitconfigContribution } from "../domain/gitconfig-contribution.js";
import { resolveGitHubIdentity } from "../infrastructure/github-identity.js";
import type { SecretStore } from "../../secret-store/index.js";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
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
  repo: ConnectionsRepository;
  templates: ConnectionTemplateRegistry;
  secretStore: SecretStore;
  runtimeMutator: RuntimeMutator;
  ownerId: string;
  callbackUrl: string;
}): OAuthFlowService {
  return {
    async startOAuth(connectionId, opts): Promise<{ authUrl: string }> {
      const conn = await deps.repo.get(connectionId, deps.ownerId);
      if (!conn) throw new Error(`connection ${connectionId} not found`);
      if (conn.auth.kind !== "oauth") {
        throw new Error(
          `connection ${connectionId} auth kind is ${conn.auth.kind}; not OAuth`,
        );
      }
      const provider = await buildProvider(conn, conn.auth, deps);
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

      const provider = await buildProvider(conn, conn.auth, deps);
      const tokens = await deps.engine.exchange({ ...pending, provider }, code);

      const sdsFields = buildConnectionSdsFields(
        conn.contributions,
        tokens.accessToken,
      );
      const fields: Record<string, string> = {
        access_token: tokens.accessToken,
        ...sdsFields,
      };
      if (tokens.refreshToken && pending.ctx.refreshTokenRef) {
        fields.refresh_token = tokens.refreshToken;
      }
      await deps.secretStore.putFields(pending.ctx.accessTokenRef, fields);

      const isReauth =
        conn.auth.kind === "oauth" &&
        (conn.auth.connectedAt !== undefined ||
          conn.auth.expiresAt !== undefined);

      if (conn.auth.kind === "oauth") {
        const updatedAuth: ConnectionAuthConfig = {
          ...withoutRefreshFailureMarker(conn.auth),
          connectedAt: Math.floor(Date.now() / 1000),
          scopes: tokens.scopes ?? pending.provider.scopes ?? conn.auth.scopes,
          ...(tokens.expiresAt !== undefined
            ? { expiresAt: tokens.expiresAt }
            : {}),
        };
        await deps.repo.updateAuth(conn.id, updatedAuth);
      }

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
      if (!isReauth) {
        emit({
          type: EventType.ConnectionCreated,
          actorSub: pending.ctx.ownerId,
          connectionKey: conn.id,
          templateId: conn.templateId,
          kind: template?.category === "mcp" ? "mcp" : "oauth_app",
        });
      }

      if (template?.id === "github") {
        await applyGitHubIdentity(conn, tokens.accessToken, deps);
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

async function buildProvider(
  conn: Connection,
  auth: Extract<ConnectionAuthConfig, { kind: "oauth" }>,
  deps: {
    templates: ConnectionTemplateRegistry;
    secretStore: SecretStore;
  },
): Promise<OAuthProvider> {
  const template = deps.templates.get(conn.templateId);
  let clientSecret =
    template && template.authKind === "oauth"
      ? template.clientSecret
      : undefined;

  if (auth.clientSecretRef) {
    const dynamicSecret = await deps.secretStore.getField(auth.clientSecretRef);
    if (dynamicSecret) clientSecret = dynamicSecret;
  }

  const templateScopes =
    template?.authKind === "oauth" && template.scopes?.length
      ? template.scopes
      : undefined;

  const provider: OAuthProvider = {
    id: `connection:${conn.id}:${conn.templateId}`,
    authorizationUrl: auth.authorizationUrl,
    tokenEndpoint: auth.tokenUrl,
    clientId: auth.clientId,
    ...(clientSecret ? { clientSecret } : {}),
    scopes: templateScopes ?? auth.scopes,
    ...(auth.tokenEndpointAcceptJson ? { tokenEndpointAcceptJson: true } : {}),
    ...(auth.extraAuthParams ? { extraAuthParams: auth.extraAuthParams } : {}),
  };
  return provider;
}
