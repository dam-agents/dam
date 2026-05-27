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
import type { SecretStore } from "../../secret-store/index.js";
import { emit, EventType } from "../../../events.js";

export interface OAuthFlowService {
  startOAuth(connectionId: string): Promise<{ authUrl: string }>;
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
    async startOAuth(connectionId): Promise<{ authUrl: string }> {
      const conn = await deps.repo.get(connectionId, deps.ownerId);
      if (!conn) throw new Error(`connection ${connectionId} not found`);
      if (conn.auth.kind !== "oauth") {
        throw new Error(
          `connection ${connectionId} auth kind is ${conn.auth.kind}; not OAuth`,
        );
      }
      const provider = await buildProvider(conn, conn.auth, deps);
      const { authUrl } = deps.engine.start<OAuthFlowPendingCtx>({
        provider,
        redirectUri: deps.callbackUrl,
        ctx: {
          connectionId,
          ownerId: deps.ownerId,
          accessTokenRef: conn.auth.accessTokenRef,
          ...(conn.auth.refreshTokenRef
            ? { refreshTokenRef: conn.auth.refreshTokenRef }
            : {}),
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

      if (conn.auth.kind === "oauth" && tokens.expiresAt !== undefined) {
        const updatedAuth: ConnectionAuthConfig = {
          ...conn.auth,
          expiresAt: tokens.expiresAt,
        };
        await deps.repo.updateAuth(conn.id, updatedAuth);
      }

      const template = deps.templates.get(conn.templateId);
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
