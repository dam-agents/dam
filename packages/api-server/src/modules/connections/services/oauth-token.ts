import type {
  Connection,
  ConnectionAuthConfig,
  GitHubUserTokenScope,
} from "api-server-api";
import type {
  OAuthEngine,
  OAuthProvider,
} from "../infrastructure/oauth-engine.js";
import type { GitHubAppEngine } from "../infrastructure/github-app-engine.js";
import type { ConnectionTemplateRegistry } from "../domain/connection-template.js";
import { buildConnectionSdsFields } from "../domain/connection-sds.js";
import { earliestExpiry } from "../domain/github-user-token-scope.js";
import type { SecretStore } from "../../secret-store/index.js";
import { scopeGitHubUserToken } from "./github-user-token.js";

export type OAuthAuth = Extract<ConnectionAuthConfig, { kind: "oauth" }>;

export async function resolveOAuthClientSecret(opts: {
  conn: Connection;
  auth: OAuthAuth;
  templates: ConnectionTemplateRegistry;
  secretStore: SecretStore;
}): Promise<string | undefined> {
  const template = opts.templates.get(opts.conn.templateId);
  let clientSecret =
    template && template.authKind === "oauth"
      ? template.clientSecret
      : undefined;
  if (opts.auth.clientSecretRef) {
    const stored = await opts.secretStore.getField(opts.auth.clientSecretRef);
    if (stored) clientSecret = stored;
  }
  return clientSecret;
}

export async function refreshOAuthAccessToken(opts: {
  conn: Connection;
  auth: OAuthAuth;
  engine: OAuthEngine;
  githubAppEngine: GitHubAppEngine;
  templates: ConnectionTemplateRegistry;
  secretStore: SecretStore;
}): Promise<{ expiresAt: number | undefined }> {
  const { conn, auth, secretStore } = opts;
  const connectionRef = `connection:${conn.id}:${conn.templateId}`;
  const clientSecret = await resolveOAuthClientSecret(opts);
  const scope = auth.githubUserTokenScope;

  const refreshToken = auth.refreshTokenRef
    ? await secretStore.getField(auth.refreshTokenRef)
    : null;
  if (!refreshToken && scope) {
    const stored = await secretStore.getField(auth.accessTokenRef);
    if (!stored) {
      throw new Error(`access token missing at ${auth.accessTokenRef.path}`);
    }
    return injectScopedToken(
      { ...opts, connectionRef, clientSecret, scope },
      { accessToken: stored },
    );
  }
  if (!auth.refreshTokenRef) {
    throw new Error("no refresh token ref");
  }
  if (!refreshToken) {
    throw new Error(`refresh token missing at ${auth.refreshTokenRef.path}`);
  }

  const provider: OAuthProvider = {
    id: connectionRef,
    authorizationUrl: auth.authorizationUrl,
    tokenEndpoint: auth.tokenUrl,
    clientId: auth.clientId,
    ...(clientSecret ? { clientSecret } : {}),
    scopes: auth.scopes,
    ...(auth.tokenEndpointAcceptJson ? { tokenEndpointAcceptJson: true } : {}),
  };

  const next = await opts.engine.refresh({ provider, refreshToken });

  const fields: Record<string, string> = { access_token: next.accessToken };
  if (next.refreshToken) fields.refresh_token = next.refreshToken;
  if (!scope) {
    await secretStore.putFields(auth.accessTokenRef, {
      ...fields,
      ...buildConnectionSdsFields(conn.contributions, next.accessToken),
    });
    return { expiresAt: next.expiresAt };
  }

  await secretStore.putFields(auth.accessTokenRef, fields);
  return injectScopedToken(
    { ...opts, connectionRef, clientSecret, scope },
    next,
  );
}

async function injectScopedToken(
  opts: {
    conn: Connection;
    auth: OAuthAuth;
    githubAppEngine: GitHubAppEngine;
    secretStore: SecretStore;
    connectionRef: string;
    clientSecret: string | undefined;
    scope: GitHubUserTokenScope;
  },
  userToken: { accessToken: string; expiresAt?: number | undefined },
): Promise<{ expiresAt: number | undefined }> {
  const scoped = await scopeGitHubUserToken(opts.githubAppEngine, {
    connectionRef: opts.connectionRef,
    auth: opts.auth,
    scope: opts.scope,
    clientSecret: opts.clientSecret,
    accessToken: userToken.accessToken,
  });
  await opts.secretStore.putFields(
    opts.auth.accessTokenRef,
    buildConnectionSdsFields(opts.conn.contributions, scoped.accessToken),
  );
  return { expiresAt: earliestExpiry(userToken.expiresAt, scoped.expiresAt) };
}
