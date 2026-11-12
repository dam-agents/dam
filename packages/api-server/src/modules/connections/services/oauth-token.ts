import type {
  Connection,
  ConnectionAuthConfig,
  GitHubUserTokenScope,
} from "api-server-api";
import { TRPCError } from "@trpc/server";
import type {
  OAuthEngine,
  OAuthProvider,
} from "../infrastructure/oauth-engine.js";
import type { GitHubAppEngine } from "../infrastructure/github-app-engine.js";
import {
  operatorAppFor,
  type ConnectionTemplateRegistry,
} from "../domain/connection-template.js";
import { discoverMcpAuth } from "../infrastructure/mcp-discovery.js";
import { buildConnectionSdsFields } from "../domain/connection-sds.js";
import { earliestExpiry } from "../domain/github-user-token-scope.js";
import type { SecretStore } from "../../secret-store/index.js";
import { scopeGitHubUserToken } from "./github-user-token.js";
import {
  rederiveGitHubChildren,
  type ChildTokenDeps,
} from "./github-children.js";

export type OAuthAuth = Extract<ConnectionAuthConfig, { kind: "oauth" }>;

export async function resolveOAuthClientSecret(opts: {
  conn: Connection;
  auth: OAuthAuth;
  templates: ConnectionTemplateRegistry;
  secretStore: SecretStore;
}): Promise<string | undefined> {
  const template = opts.templates.get(opts.conn.templateId);
  if (opts.auth.clientSecretRef) {
    const stored = await opts.secretStore.getField(opts.auth.clientSecretRef);
    if (stored) return stored;
  }
  if (template?.authKind !== "oauth") return undefined;
  const app = operatorAppFor(template, opts.auth.host);
  if (
    template.hostApps &&
    opts.auth.host &&
    !opts.auth.clientSecretRef &&
    !app.clientId
  ) {
    throw new Error(
      `No GitHub app is registered for ${opts.auth.host} any more. Move this sign-in to another host, or connect it again with your own app.`,
    );
  }
  return app.clientSecret;
}

export async function oauthProviderFor(opts: {
  conn: Connection;
  auth: OAuthAuth;
  templates: ConnectionTemplateRegistry;
  secretStore: SecretStore;
}): Promise<OAuthProvider> {
  const { conn, auth } = opts;
  const template = opts.templates.get(conn.templateId);
  const templateScopes =
    template?.authKind === "oauth" && template.scopes?.length
      ? template.scopes
      : undefined;
  const dynamicMcp =
    template?.authKind === "oauth" && template.dynamicRegistration === true;
  const scopes = dynamicMcp
    ? (auth.requestedScopes ?? auth.scopes)
    : (templateScopes ?? auth.scopes);
  const clientSecret = await resolveOAuthClientSecret(opts);
  return {
    id: `connection:${conn.id}:${conn.templateId}`,
    authorizationUrl: auth.authorizationUrl,
    tokenEndpoint: auth.tokenUrl,
    clientId: auth.clientId,
    ...(clientSecret ? { clientSecret } : {}),
    scopes,
    ...(auth.resource ? { resource: auth.resource } : {}),
    ...(auth.tokenEndpointAcceptJson ? { tokenEndpointAcceptJson: true } : {}),
    ...(auth.extraAuthParams ? { extraAuthParams: auth.extraAuthParams } : {}),
  };
}

export async function oauthProviderForSignIn(opts: {
  conn: Connection;
  auth: OAuthAuth;
  templates: ConnectionTemplateRegistry;
  secretStore: SecretStore;
}): Promise<OAuthProvider> {
  const provider = await oauthProviderFor(opts);
  const template = opts.templates.get(opts.conn.templateId);
  if (template?.authKind !== "oauth" || !template.dynamicRegistration)
    return provider;
  const url = opts.conn.inputs.url;
  if (typeof url !== "string")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "MCP connection has no endpoint to rediscover",
    });
  const metadata = await discoverMcpAuth(new URL(url));
  if (!metadata)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "MCP OAuth metadata could not be rediscovered; try signing in again later",
    });
  if (
    metadata.authorizationEndpoint !== provider.authorizationUrl ||
    metadata.tokenEndpoint !== provider.tokenEndpoint
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "MCP authorization server changed; create a new connection to sign in",
    });
  if (metadata.source === "authorization-server")
    return opts.auth.resource
      ? provider
      : { ...provider, scopes: template.scopes ?? [] };
  if (opts.auth.resource && metadata.resource !== opts.auth.resource)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "MCP resource metadata changed; try signing in again later or create a new connection",
    });
  return {
    ...provider,
    scopes: metadata.scopes ?? template.scopes ?? [],
    resource: metadata.resource,
  };
}

export async function refreshOAuthAccessToken(opts: {
  conn: Connection;
  auth: OAuthAuth;
  engine: OAuthEngine;
  githubAppEngine: GitHubAppEngine;
  templates: ConnectionTemplateRegistry;
  secretStore: SecretStore;
  children: ChildTokenDeps["repo"];
}): Promise<{ expiresAt: number | undefined }> {
  const { conn, auth, secretStore } = opts;
  const connectionRef = `connection:${conn.id}:${conn.templateId}`;
  const provider = await oauthProviderFor(opts);
  const clientSecret = provider.clientSecret;
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

  const next = await opts.engine.refresh({ provider, refreshToken });

  const fields: Record<string, string> = { access_token: next.accessToken };
  if (next.refreshToken) fields.refresh_token = next.refreshToken;
  if (conn.isParent) {
    await secretStore.putFields(auth.accessTokenRef, fields);
    const expiresAt = await rederiveGitHubChildren(
      {
        repo: opts.children,
        secretStore,
        githubAppEngine: opts.githubAppEngine,
      },
      conn,
      next,
      clientSecret,
    );
    return { expiresAt };
  }
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
