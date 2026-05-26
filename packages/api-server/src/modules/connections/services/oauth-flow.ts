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

      // Connection record is needed for its `contributions` — we have to
      // recompute the per-host SDS files anchored on the new access
      // token. Read it before writing so a missing/stale row fails the
      // callback rather than producing a half-populated Secret.
      const conn = await deps.repo.get(
        pending.ctx.connectionId,
        pending.ctx.ownerId,
      );
      if (!conn) {
        throw new Error(`connection ${pending.ctx.connectionId} not found`);
      }

      // Write raw tokens (consumed by the refresh loop's `getField`)
      // alongside per-host SDS files (read directly by the gateway pod's
      // Envoy via `path_config_source`). Both must land on the same K8s
      // Secret in one update so kubelet propagates them together — a
      // half-written Secret would either crash Envoy's bootstrap (missing
      // SDS file) or hand Envoy a stale token under a fresh expiry.
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

      // Update the Connection's auth so the refresh loop / status pill
      // sees the new expiry. Read-modify-write — small enough to be fine
      // without a row-level lock.
      if (conn.auth.kind === "oauth" && tokens.expiresAt !== undefined) {
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
 * Build the engine's OAuthProvider from a Connection + its template.
 * The Connection's auth carries the wire shape (clientId + endpoints +
 * scopes); the template carries the operator-supplied `clientSecret`
 * (it's not on the wire). DCR templates set `auth.clientSecretRef` and
 * the SecretStore supplies the per-Connection secret.
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
