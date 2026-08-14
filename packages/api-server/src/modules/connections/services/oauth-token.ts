import type { Connection, ConnectionAuthConfig } from "api-server-api";
import type {
  OAuthEngine,
  OAuthProvider,
} from "../infrastructure/oauth-engine.js";
import type { ConnectionTemplateRegistry } from "../domain/connection-template.js";
import { buildConnectionSdsFields } from "../domain/connection-sds.js";
import type { SecretStore } from "../../secret-store/index.js";

export type OAuthAuth = Extract<ConnectionAuthConfig, { kind: "oauth" }>;

export async function refreshOAuthAccessToken(opts: {
  conn: Connection;
  auth: OAuthAuth;
  engine: OAuthEngine;
  templates: ConnectionTemplateRegistry;
  secretStore: SecretStore;
}): Promise<{ expiresAt: number | undefined }> {
  const { conn, auth, secretStore } = opts;
  if (!auth.refreshTokenRef) {
    throw new Error("no refresh token ref");
  }
  const refreshToken = await secretStore.getField(auth.refreshTokenRef);
  if (!refreshToken) {
    throw new Error(`refresh token missing at ${auth.refreshTokenRef.path}`);
  }

  const template = opts.templates.get(conn.templateId);
  let clientSecret =
    template && template.authKind === "oauth"
      ? template.clientSecret
      : undefined;
  if (auth.clientSecretRef) {
    const stored = await secretStore.getField(auth.clientSecretRef);
    if (stored) clientSecret = stored;
  }

  const provider: OAuthProvider = {
    id: `connection:${conn.id}:${conn.templateId}`,
    authorizationUrl: auth.authorizationUrl,
    tokenEndpoint: auth.tokenUrl,
    clientId: auth.clientId,
    ...(clientSecret ? { clientSecret } : {}),
    scopes: auth.scopes,
    ...(auth.tokenEndpointAcceptJson ? { tokenEndpointAcceptJson: true } : {}),
  };

  const next = await opts.engine.refresh({ provider, refreshToken });

  const fields: Record<string, string> = {
    access_token: next.accessToken,
    ...buildConnectionSdsFields(conn.contributions, next.accessToken),
  };
  if (next.refreshToken) fields.refresh_token = next.refreshToken;
  await secretStore.putFields(auth.accessTokenRef, fields);

  return { expiresAt: next.expiresAt };
}
