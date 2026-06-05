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
import { applyCallbackAlias } from "../domain/oauth-callback-url.js";
import type { SecretStore } from "../../secret-store/index.js";
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
      const { authUrl } = deps.engine.start<OAuthFlowPendingCtx>({
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
      const pending = deps.engine.consume<OAuthFlowPendingCtx>(state);
      if (!pending) throw new Error("invalid or expired OAuth state");

      const tokens = await deps.engine.exchange(pending, code);

      const conn = await deps.repo.get(
        pending.ctx.connectionId,
        pending.ctx.ownerId,
      );
      if (!conn) {
        throw new Error(`connection ${pending.ctx.connectionId} not found`);
      }

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

      if (conn.auth.kind === "oauth") {
        // Completion marker for status derivation — written on every
        // successful exchange, even when the provider returns no expiry.
        const updatedAuth: ConnectionAuthConfig = {
          ...conn.auth,
          connectedAt: Math.floor(Date.now() / 1000),
          ...(tokens.expiresAt !== undefined
            ? { expiresAt: tokens.expiresAt }
            : {}),
        };
        await deps.repo.updateAuth(conn.id, updatedAuth);
      }

      const template = deps.templates.get(conn.templateId);
      // Long-lived credentials minted via the public, unauthenticated callback
      // — record the mint (never the tokens).
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
        },
      });
      emit({
        type: EventType.ConnectionCreated,
        actorSub: pending.ctx.ownerId,
        connectionKey: conn.id,
        kind: template?.category === "mcp" ? "mcp" : "oauth_app",
      });

      return {
        connectionId: pending.ctx.connectionId,
        ownerId: pending.ctx.ownerId,
      };
    },
  };
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

  const provider: OAuthProvider = {
    id: `connection:${conn.id}:${conn.templateId}`,
    authorizationUrl: auth.authorizationUrl,
    tokenEndpoint: auth.tokenUrl,
    clientId: auth.clientId,
    ...(clientSecret ? { clientSecret } : {}),
    scopes: auth.scopes,
    ...(auth.tokenEndpointAcceptJson ? { tokenEndpointAcceptJson: true } : {}),
    ...(auth.extraAuthParams ? { extraAuthParams: auth.extraAuthParams } : {}),
  };
  return provider;
}
