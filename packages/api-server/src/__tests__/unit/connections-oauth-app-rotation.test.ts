import { describe, expect, it } from "vitest";
import type { Connection, SecretRef } from "api-server-api";

import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import {
  createConnectionTemplateRegistry,
  oauthClientIdFor,
} from "../../modules/connections/domain/connection-template.js";
import { refreshOAuthAccessToken } from "../../modules/connections/services/oauth-token.js";
import { createOAuthFlowService } from "../../modules/connections/services/oauth-flow.js";
import type {
  OAuthEngine,
  OAuthProvider,
} from "../../modules/connections/infrastructure/oauth-engine.js";
import type {
  GitHubAppEngine,
  ScopeUserTokenOpts,
} from "../../modules/connections/infrastructure/github-app-engine.js";
import type { ConnectionsRepository } from "../../modules/connections/infrastructure/connections-repository.js";
import type { SecretStore } from "../../modules/secret-store/index.js";
import { fakeMcpToolLister, unused } from "../helpers/connections-service.js";

/**
 * TEST_OVERVIEW: an operator rotates a template's OAuth app in the chart, a
 * new client ID and secret. A connection made on the operator's app stores
 * the client ID of the day it was made but never the secret, which is read
 * from the chart each time; it must sign in, exchange and renew with the
 * current app, ID and secret together, or every sign-in pairs the old ID with
 * the new secret and fails. A connection made with its own app keeps it.
 */

const HOST = "github.example.com";
const CALLBACK = "https://cb.example/oauth/callback";

const templates = createConnectionTemplateRegistry(
  buildCatalog({
    githubEnterprise: {
      host: HOST,
      clientId: "Iv1.new",
      clientSecret: "new-secret",
      appSlug: "dam",
    },
  }),
);

const ref = (path: string, field: string): SecretRef => ({
  storeId: "test",
  path,
  field,
});

function connection(
  id: string,
  extra: Partial<Extract<Connection["auth"], { kind: "oauth" }>> = {},
  conn: Partial<Connection> = {},
): Connection {
  return {
    id,
    ownerId: "owner",
    templateId: "github-enterprise",
    name: id,
    inputs: { host: HOST },
    auth: {
      kind: "oauth",
      clientId: "Iv1.old",
      refreshTokenRef: ref(`secret-${id}`, "refresh_token"),
      accessTokenRef: ref(`secret-${id}`, "access_token"),
      scopes: [],
      authorizationUrl: `https://${HOST}/login/oauth/authorize`,
      tokenUrl: `https://${HOST}/login/oauth/access_token`,
      tokenEndpointAcceptJson: true,
      host: HOST,
      connectedAt: 1_700_000_000,
      ...extra,
    },
    contributions: [],
    ...conn,
  };
}

function oauth(conn: Connection) {
  if (conn.auth.kind !== "oauth") throw new Error("not oauth");
  return conn.auth;
}

function fakes() {
  const secrets = new Map<string, Record<string, string>>([
    ["secret-signin", { refresh_token: "ghr_1" }],
    ["secret-own", { refresh_token: "ghr_1", client_secret: "own-secret" }],
  ]);
  const secretStore = unused<SecretStore>({
    getField: async (r) => secrets.get(r.path)?.[r.field] ?? null,
    putFields: async (r, fields) => {
      secrets.set(r.path, { ...secrets.get(r.path), ...fields });
    },
  });
  const started: OAuthProvider[] = [];
  const refreshed: OAuthProvider[] = [];
  const engine = unused<OAuthEngine>({
    start: async ({ provider }) => {
      started.push(provider);
      return { authUrl: "https://auth.example", state: "s" };
    },
    refresh: async ({ provider }) => {
      refreshed.push(provider);
      return { accessToken: "ghu_2", refreshToken: "ghr_2" };
    },
  });
  const scoped: ScopeUserTokenOpts[] = [];
  const githubAppEngine = unused<GitHubAppEngine>({
    scopeUserToken: async (opts) => {
      scoped.push(opts);
      return { accessToken: "ghu_scoped" };
    },
  });
  return {
    secretStore,
    engine,
    githubAppEngine,
    started,
    refreshed,
    scoped,
  };
}

function signInFlow(
  rows: Connection[],
  f: ReturnType<typeof fakes>,
): ReturnType<typeof createOAuthFlowService> {
  return createOAuthFlowService({
    engine: f.engine,
    githubAppEngine: f.githubAppEngine,
    repo: unused<ConnectionsRepository>({
      get: async (id) => rows.find((r) => r.id === id) ?? null,
    }),
    templates,
    secretStore: f.secretStore,
    runtimeMutator: unused(),
    ownerId: "owner",
    callbackUrl: CALLBACK,
    connectionLock: unused(),
    mcpToolLister: fakeMcpToolLister(),
  });
}

describe("a connection on the operator's app after the app is rotated", () => {
  // TEST_SCENARIO: "Sign in again" must authorize with the app the chart names now; the provider handed to the flow is also the one its code is exchanged with, so the exchange uses the new ID and secret too.
  it("signs in again with the new client ID and secret", async () => {
    const f = fakes();
    await signInFlow([connection("signin")], f).startOAuth("signin");
    expect(f.started).toHaveLength(1);
    expect(f.started[0]).toMatchObject({
      clientId: "Iv1.new",
      clientSecret: "new-secret",
    });
  });

  // TEST_SCENARIO: a renewal must send the new client ID with the new secret, not the ID stored before the rotation.
  it("renews with the new client ID and secret", async () => {
    const f = fakes();
    const conn = connection("signin");
    await refreshOAuthAccessToken({
      conn,
      auth: oauth(conn),
      engine: f.engine,
      githubAppEngine: f.githubAppEngine,
      templates,
      secretStore: f.secretStore,
      children: unused(),
    });
    expect(f.refreshed[0]).toMatchObject({
      clientId: "Iv1.new",
      clientSecret: "new-secret",
    });
  });

  // TEST_SCENARIO: a connection made from a GitHub sign-in is narrowed by the sign-in's app; after a rotation GitHub must be asked with the new app's ID, or every narrowed connection fails on renewal.
  it("narrows the connections made from a sign-in with the new app", async () => {
    const f = fakes();
    const parent = connection("signin", {}, { isParent: true });
    const child = connection(
      "child",
      {
        githubUserTokenScope: { targetId: 7, repositoryIds: [1] },
      },
      { parentId: "signin" },
    );
    delete oauth(child).refreshTokenRef;
    const children = unused<ConnectionsRepository>({
      listChildren: async () => [child],
      updateAuth: async () => undefined,
    });
    await refreshOAuthAccessToken({
      conn: parent,
      auth: oauth(parent),
      engine: f.engine,
      githubAppEngine: f.githubAppEngine,
      templates,
      secretStore: f.secretStore,
      children,
    });
    expect(f.scoped).toHaveLength(1);
    expect(f.scoped[0]).toMatchObject({
      clientId: "Iv1.new",
      clientSecret: "new-secret",
    });
  });
});

describe("a connection made with its own app", () => {
  // TEST_SCENARIO: a user who brought their own client ID and secret keeps signing in and renewing with them; a rotation of the operator's app must not touch it.
  it("keeps its own client ID through sign-in and renewal", async () => {
    const f = fakes();
    const own = connection("own", {
      clientId: "Iv1.mine",
      clientSecretRef: ref("secret-own", "client_secret"),
    });
    await signInFlow([own], f).startOAuth("own");
    await refreshOAuthAccessToken({
      conn: own,
      auth: oauth(own),
      engine: f.engine,
      githubAppEngine: f.githubAppEngine,
      templates,
      secretStore: f.secretStore,
      children: unused(),
    });
    for (const provider of [f.started[0], f.refreshed[0]]) {
      expect(provider).toMatchObject({
        clientId: "Iv1.mine",
        clientSecret: "own-secret",
      });
    }
  });
});

describe("the client ID a connection uses", () => {
  // TEST_SCENARIO: a dynamically registered client, or a template the operator gave no app, has only the ID it stored; that one is kept.
  it("keeps the stored ID where the operator has no app to read", () => {
    const auth = oauth(connection("x"));
    expect(oauthClientIdFor(null, auth)).toBe("Iv1.old");
    const noApp = createConnectionTemplateRegistry(
      buildCatalog({ githubEnterprise: { host: HOST } }),
    ).get("github-enterprise");
    expect(oauthClientIdFor(noApp, auth)).toBe("Iv1.old");
    const dcr = buildCatalog({}).find(
      (t) => t.authKind === "oauth" && t.dynamicRegistration,
    );
    expect(dcr).toBeDefined();
    expect(oauthClientIdFor(dcr, auth)).toBe("Iv1.old");
  });
});
