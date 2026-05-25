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
import type { SecretStore } from "../../secret-store/index.js";

/**
 * OAuth flow orchestration on top of SecretStore + ConnectionsRepository
 * (ADR-051). The OAuth engine is generic; this service is what makes the
 * flow Connection-aware.
 *
 * Lifecycle:
 *   1. UI creates a Connection from a template. For OAuth templates the
 *      auth is populated with `clientId` + endpoints; token refs point
 *      at SecretStore paths that don't yet have token fields.
 *   2. UI calls `startOAuth(connectionId)` → returns authUrl.
 *   3. User authorizes at the provider. Provider redirects to our
 *      callback URL with code + state.
 *   4. `completeOAuth(state, code)` exchanges the code, writes tokens
 *      via SecretStore.putField, updates the Connection's
 *      `auth.expiresAt`.
 */
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
  /** Public callback URL — same for every flow; the `state` parameter
   *  distinguishes them. Built from UI base URL at compose time. */
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

      // Write tokens at the SecretRef paths the Connection minted at
      // create time. We use putField so a refresh-only update doesn't
      // clobber a sibling field at the same path.
      await deps.secretStore.putField(
        pending.ctx.accessTokenRef,
        tokens.accessToken,
      );
      if (tokens.refreshToken && pending.ctx.refreshTokenRef) {
        await deps.secretStore.putField(
          pending.ctx.refreshTokenRef,
          tokens.refreshToken,
        );
      }

      // Update the Connection's auth so the refresh loop / status pill
      // sees the new expiry. Read-modify-write — small enough to be fine
      // without a row-level lock.
      const conn = await deps.repo.get(
        pending.ctx.connectionId,
        pending.ctx.ownerId,
      );
      if (
        conn &&
        conn.auth.kind === "oauth" &&
        tokens.expiresAt !== undefined
      ) {
        const updatedAuth: ConnectionAuthConfig = {
          ...conn.auth,
          expiresAt: tokens.expiresAt,
        };
        await deps.repo.updateAuth(conn.id, updatedAuth);
      }

      return {
        connectionId: pending.ctx.connectionId,
        ownerId: pending.ctx.ownerId,
      };
    },
  };
}

/**
 * Build the engine's OAuthProvider from a Connection's auth + the
 * template's static extras. The Connection's auth is the wire shape
 * (clientId + endpoints + scopes); the template supplies the operator's
 * `clientSecret` for static apps. DCR-based templates put the per-
 * Connection secret in `auth.clientSecretRef` and the SecretStore reads
 * it at flow time.
 */
async function buildProvider(
  conn: Connection,
  auth: Extract<ConnectionAuthConfig, { kind: "oauth" }>,
  deps: {
    templates: ConnectionTemplateRegistry;
    secretStore: SecretStore;
  },
): Promise<OAuthProvider> {
  const template = deps.templates.get(conn.templateId);
  let clientSecret = template?.oauthExtras?.()?.clientSecret;

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
