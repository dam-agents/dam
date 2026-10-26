import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionAuthConfig,
  SecretRef,
} from "api-server-api";
import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { createConnectionsService } from "../../modules/connections/services/connections-service.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import {
  createOAuthEngine,
  type OAuthEngine,
  type PendingFlow,
} from "../../modules/connections/infrastructure/oauth-engine.js";
import { createGitHubAppEngine } from "../../modules/connections/infrastructure/github-app-engine.js";
import {
  CONNECTION_TOKEN_PLACEHOLDER,
  sdsFileKeyForHost,
} from "../../modules/connections/domain/connection-sds.js";
import { refreshOAuthAccessToken } from "../../modules/connections/services/oauth-token.js";
import {
  createOAuthFlowService,
  type OAuthFlowPendingCtx,
  type OAuthFlowService,
} from "../../modules/connections/services/oauth-flow.js";
import type { ConnectionsRepository } from "../../modules/connections/infrastructure/connections-repository.js";
import type { SecretStore } from "../../modules/secret-store/index.js";
import type { RuntimeMutator } from "../../modules/runtime-delivery/index.js";

/**
 * TEST_OVERVIEW: a GitHub sign-in made through the GitHub App is a parent: it
 * holds the user token and the refresh token, and no agent can be given it.
 * Agents get connections made from it, each with its own Secret and token: a
 * scope (an account, repositories, permissions) GitHub derives a token for, or
 * full access named on purpose. Renewing the sign-in renews every connection
 * made from it, and removing it removes them all.
 */

const NOW_MS = 1_800_000_000_000;
const NOW_SEC = Math.floor(NOW_MS / 1000);
const OWNER = "owner-sub";
const PARENT_SECRET = "secret-sign-in";
const API_SDS = sdsFileKeyForHost("api.github.com");

type OAuthAuth = Extract<ConnectionAuthConfig, { kind: "oauth" }>;

const ref = (path: string, field: string): SecretRef => ({
  storeId: "test",
  path,
  field,
});

const CONTRIBUTIONS: Connection["contributions"] = [
  {
    kind: "egress-inject",
    host: "api.github.com",
    headerName: "Authorization",
    valueFormat: "Bearer {value}",
  },
];

function signIn(): Connection {
  return {
    id: "conn-signin",
    ownerId: OWNER,
    templateId: "github",
    name: "github",
    inputs: { accountLabel: "octocat" },
    isParent: true,
    auth: {
      kind: "oauth",
      clientId: "Iv1.client",
      refreshTokenRef: ref(PARENT_SECRET, "refresh_token"),
      accessTokenRef: ref(PARENT_SECRET, "access_token"),
      scopes: [],
      tokenUrl: "https://github.com/login/oauth/access_token",
      authorizationUrl: "https://github.com/login/oauth/authorize",
      connectedAt: NOW_SEC - 3600,
      expiresAt: NOW_SEC + 28_000,
      tokenEndpointAcceptJson: true,
    },
    contributions: CONTRIBUTIONS,
  };
}

interface Call {
  url: string;
  body: Record<string, unknown> | undefined;
  authorization: string | undefined;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeGitHub() {
  const calls: Call[] = [];
  const state = { refuseScoped: false, scoped: 0 };
  const engine = createGitHubAppEngine({
    now: () => NOW_MS,
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const call: Call = {
        url: String(url),
        body:
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : undefined,
        authorization: (init?.headers as Record<string, string> | undefined)
          ?.Authorization,
      };
      calls.push(call);
      if (call.url.endsWith("/token/scoped")) {
        if (state.refuseScoped) {
          return json({ message: "Validation Failed" }, 422);
        }
        state.scoped += 1;
        return json({
          token: `ghu_scoped_${state.scoped}`,
          expires_at: new Date((NOW_SEC + 1800) * 1000).toISOString(),
          installation: { account: { login: "acme" } },
        });
      }
      if (call.url.includes("/user/installations?")) {
        return json({
          installations: [
            {
              id: 100,
              target_id: 42,
              account: { id: 42, login: "acme" },
              permissions: { contents: "write" },
              repository_selection: "selected",
            },
          ],
        });
      }
      if (call.url.includes("/user/installations/100/repositories")) {
        return json({
          repositories: [
            { id: 7, name: "docs" },
            { id: 8, name: "web" },
          ],
        });
      }
      return json({ message: "Not Found" }, 404);
    }) as typeof fetch,
  });
  return { engine, calls, state };
}

function makeSecretStore() {
  const stored = new Map<string, Record<string, string>>([
    [PARENT_SECRET, { access_token: "ghu_user", refresh_token: "ghr_1" }],
  ]);
  const annotations = new Map<string, Record<string, string>>();
  const deleted: string[] = [];
  let minted = 0;
  const store: SecretStore = {
    storeId: "test",
    mintRef: () => ({ storeId: "test", path: `secret-${++minted}`, field: "" }),
    put: async (r, fields, meta) => {
      stored.set(r.path, { ...fields });
      annotations.set(r.path, meta.extraAnnotations ?? {});
    },
    putFields: async (r, fields) => {
      stored.set(r.path, { ...(stored.get(r.path) ?? {}), ...fields });
    },
    get: async (r) => stored.get(r.path) ?? null,
    getField: async (r) => stored.get(r.path)?.[r.field] ?? null,
    delete: async (r) => {
      deleted.push(r.path);
      stored.delete(r.path);
    },
  };
  return { store, stored, annotations, deleted };
}

function makeRepo(initial: Connection[]) {
  const rows = new Map(initial.map((c) => [c.id, c]));
  const grants = new Set<string>();
  const agentsOf = (id: string) =>
    [...grants].flatMap((g) => {
      const [c, a] = g.split("|");
      return c === id ? [a!] : [];
    });
  const repo: ConnectionsRepository = {
    insert: async (input) => {
      if (
        [...rows.values()].some(
          (r) => !r.isParent === !input.isParent && r.name === input.name,
        )
      ) {
        throw Object.assign(new Error("duplicate"), { code: "23505" });
      }
      rows.set(input.id, { ...input });
    },
    listByOwner: async (ownerId) =>
      [...rows.values()].filter((c) => c.ownerId === ownerId),
    listChildren: async (parentId) =>
      [...rows.values()].filter((c) => c.parentId === parentId),
    listByOwnerOldestFirst: async (ownerId) =>
      [...rows.values()].filter((c) => c.ownerId === ownerId),
    get: async (id, ownerId) => {
      const c = rows.get(id);
      return c && c.ownerId === ownerId ? c : null;
    },
    getById: async (id) => rows.get(id) ?? null,
    listDue: async () => [],
    updateAuth: async (id, auth) => {
      const c = rows.get(id);
      if (c) rows.set(id, { ...c, auth });
    },
    updateContributions: async (id, contributions) => {
      const c = rows.get(id);
      if (c) rows.set(id, { ...c, contributions });
    },
    mergeInputs: async (id, inputs) => {
      const c = rows.get(id);
      if (c) rows.set(id, { ...c, inputs: { ...c.inputs, ...inputs } });
    },
    delete: async (id) => {
      const removed = [
        id,
        ...[...rows.values()].flatMap((c) => (c.parentId === id ? [c.id] : [])),
      ];
      for (const r of removed) {
        rows.delete(r);
        for (const g of grants) if (g.startsWith(`${r}|`)) grants.delete(g);
      }
    },
    grant: async (c, a) => void grants.add(`${c}|${a}`),
    revoke: async (c, a) => void grants.delete(`${c}|${a}`),
    setPreferred: async () => {},
    listAgentGrants: async (agentId) =>
      [...grants].flatMap((g) => {
        const [c, a] = g.split("|");
        return a === agentId
          ? [{ connectionId: c!, grantedAt: new Date(0), preferred: false }]
          : [];
      }),
    listConnectionsForAgent: async (agentId) =>
      [...rows.values()].filter((c) => grants.has(`${c.id}|${agentId}`)),
    listAgentsForConnection: async (id) => agentsOf(id),
    revokeAllForAgent: async () => {},
    listDistinctGrantAgentIds: async () => [],
    updateName: async () => {},
    listOwnersOfTemplate: async () => [],
  };
  return { repo, rows, grants };
}

const templates = createConnectionTemplateRegistry(
  buildCatalog({ github: { clientId: "Iv1.client", clientSecret: "shh" } }),
);

const unusedOAuthFlow: OAuthFlowService = {
  startOAuth: async () => {
    throw new Error("startOAuth must not be called");
  },
  completeOAuth: async () => {
    throw new Error("completeOAuth must not be called");
  },
};

function makeService(initial: Connection[] = [signIn()]) {
  const { repo, rows, grants } = makeRepo(initial);
  const secrets = makeSecretStore();
  const github = makeGitHub();
  const fannedOut: string[] = [];
  const svc = createConnectionsService({
    harnesses: { default: "claude-code", harnesses: [] },
    isOwnedAgent: async () => true,
    ownerId: OWNER,
    templates,
    repo,
    secretStore: secrets.store,
    fanOut: {
      apply: async (input) => void fannedOut.push(input.agentId),
    },
    oauthFlow: unusedOAuthFlow,
    oauthEngine: createOAuthEngine({
      pendingStore: createMemoryTtlStore(600_000),
      now: () => NOW_MS,
    }),
    githubAppEngine: github.engine,
    s3CredentialProbe: {
      probe: async () => {
        throw new Error("Unexpected dependency: s3CredentialProbe");
      },
    },
    providerBalance: {
      lookup: async () => {
        throw new Error("Unexpected dependency: providerBalance");
      },
    },
    credentialProbe: { probe: async () => ({ status: "passed" }) },
    providerKeyProbe: { probe: async () => ({ ok: true }) },
    oauthCallbackUrl: "https://cb.example/oauth/callback",
    brandName: "Test",
    connectionLock: <T>(_key: string, fn: () => Promise<T>): Promise<T> => fn(),
    resolveKbShare: async () => null,
  });
  return { svc, repo, rows, grants, fannedOut, ...secrets, github };
}

function oauthAuthOf(conn: Connection | undefined): OAuthAuth {
  if (conn?.auth.kind !== "oauth") throw new Error("not an OAuth connection");
  return conn.auth;
}

const NARROWED = {
  parentId: "conn-signin",
  name: "github-docs",
  targetId: 42,
  repositoryIds: "7",
  permissions: "contents:read",
};

const FULL = {
  parentId: "conn-signin",
  name: "github-everything",
  fullAccess: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHub sign-in — the sign-in itself", () => {
  // TEST_SCENARIO: signing in gives no agent anything yet: the sign-in is a parent, its Secret names no host to inject on, and a grant of it is refused, so full access is never what a user gets by not choosing.
  it("is a parent that no agent can be given", async () => {
    const { svc, rows, annotations } = makeService([]);
    const id = await svc.createFromTemplate({
      templateId: "github",
      name: "github",
      authKind: "oauth",
    });

    expect(rows.get(id)?.isParent).toBe(true);
    expect((await svc.getConnection(id))?.isParent).toBe(true);
    const secretPath = oauthAuthOf(rows.get(id)).accessTokenRef.path;
    expect(annotations.get(secretPath)).toEqual({});

    await expect(
      svc.setAgentConnections("agent-a", [id]),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /GitHub sign-in/ });
    await expect(svc.validateGrantSet([id])).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("GitHub sign-in — connections made from it", () => {
  // TEST_SCENARIO: a narrowed connection injects only the token GitHub derives for its account, repositories and permissions, from its own Secret; the user token and the refresh token stay in the sign-in's Secret alone.
  it("narrows a connection with its own token", async () => {
    const { svc, rows, stored, github } = makeService();

    const id = await svc.createFromParent(NARROWED);

    const child = rows.get(id)!;
    expect(child.parentId).toBe("conn-signin");
    const auth = oauthAuthOf(child);
    expect(auth.refreshTokenRef).toBeUndefined();
    expect(auth.githubUserTokenScope).toEqual({
      targetId: 42,
      targetLogin: "acme",
      repositoryIds: [7],
      repositoryNames: ["docs"],
      permissions: { contents: "read" },
    });
    expect(auth.accessTokenRef.path).not.toBe(PARENT_SECRET);
    const own = stored.get(auth.accessTokenRef.path)!;
    expect(own.access_token).toBe("ghu_scoped_1");
    expect(own[API_SDS]).toContain("Bearer ghu_scoped_1");
    expect(JSON.stringify(own)).not.toContain("ghu_user");
    expect(stored.get(PARENT_SECRET)).toEqual({
      access_token: "ghu_user",
      refresh_token: "ghr_1",
    });
    const scopedCall = github.calls.find((c) => c.url.endsWith("/scoped"));
    expect(scopedCall?.body).toMatchObject({
      access_token: "ghu_user",
      target_id: 42,
      repository_ids: [7],
    });
    expect(child.inputs).toMatchObject({ accountLabel: "octocat" });
  });

  // TEST_SCENARIO: full access is a choice the user names: the connection injects the sign-in's user token and says so on its view.
  it("gives full access only when it is asked for", async () => {
    const { svc, rows, stored, github } = makeService();

    const id = await svc.createFromParent(FULL);

    const auth = oauthAuthOf(rows.get(id));
    expect(auth.fullAccess).toBe(true);
    expect(auth.githubUserTokenScope).toBeUndefined();
    expect(stored.get(auth.accessTokenRef.path)!.access_token).toBe("ghu_user");
    expect(github.calls.some((c) => c.url.endsWith("/scoped"))).toBe(false);
    expect((await svc.getConnection(id))?.fullAccess).toBe(true);
  });

  // TEST_SCENARIO: a connection that names no scope and no full access is refused before anything is stored, so the absence of a choice is never read as everything.
  it("refuses a connection that names neither a scope nor full access", async () => {
    const { svc, rows, stored } = makeService();

    await expect(
      svc.createFromParent({ parentId: "conn-signin", name: "github-x" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /full access/ });
    await expect(
      svc.createFromParent({ ...NARROWED, fullAccess: true }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /not both/ });

    expect([...rows.keys()]).toEqual(["conn-signin"]);
    expect([...stored.keys()]).toEqual([PARENT_SECRET]);
  });

  // TEST_SCENARIO: one sign-in backs a read-only agent and a read-write agent side by side: a second connection is added beside the first, which keeps its scope and token.
  it("adds a second connection without changing the first", async () => {
    const { svc, rows, stored } = makeService();
    const first = await svc.createFromParent(NARROWED);
    const firstAuth = oauthAuthOf(rows.get(first));
    const firstToken = stored.get(firstAuth.accessTokenRef.path)!.access_token;

    const second = await svc.createFromParent(FULL);

    expect(rows.get(first)!.auth).toEqual(firstAuth);
    expect(stored.get(firstAuth.accessTokenRef.path)!.access_token).toBe(
      firstToken,
    );
    const views = await svc.listConnections();
    expect(
      views.filter((v) => v.parentId === "conn-signin").map((v) => v.id),
    ).toEqual([first, second]);
  });

  it("refuses a second connection with a name already in use", async () => {
    const { svc } = makeService();
    await svc.createFromParent(NARROWED);
    await expect(
      svc.createFromParent({ ...FULL, name: NARROWED.name }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("makes connections only from a sign-in", async () => {
    const { svc } = makeService();
    const id = await svc.createFromParent(FULL);
    await expect(
      svc.createFromParent({ ...FULL, parentId: id, name: "nested" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // TEST_SCENARIO: a narrowed token can expire before the user token does, so the sign-in's next renewal moves up to the earliest expiry among its connections.
  it("moves the sign-in's renewal up to its earliest connection", async () => {
    const { svc, rows } = makeService();
    await svc.createFromParent(NARROWED);
    expect(oauthAuthOf(rows.get("conn-signin")).expiresAt).toBe(NOW_SEC + 1800);
  });

  it("can be given to an agent", async () => {
    const { svc, grants } = makeService();
    const id = await svc.createFromParent(NARROWED);
    await svc.updateAgentConnections("agent-a", { grant: [id], revoke: [] });
    expect(grants.has(`${id}|agent-a`)).toBe(true);
  });
});

describe("GitHub sign-in — renewal", () => {
  function refreshingEngine(): OAuthEngine {
    return {
      refresh: async () => ({
        accessToken: "ghu_user2",
        refreshToken: "ghr_2",
        expiresAt: NOW_SEC + 28_800,
      }),
    } as unknown as OAuthEngine;
  }

  // TEST_SCENARIO: GitHub rotates the user token on every refresh, so each connection made from the sign-in gets a token from the new one: the full-access one the new user token, a narrowed one a freshly derived token.
  it("gives every connection a token from the new user token", async () => {
    const { svc, repo, rows, stored, store, github } = makeService();
    const narrowed = await svc.createFromParent(NARROWED);
    const full = await svc.createFromParent(FULL);
    const parent = rows.get("conn-signin")!;

    const out = await refreshOAuthAccessToken({
      conn: parent,
      auth: oauthAuthOf(parent),
      engine: refreshingEngine(),
      githubAppEngine: github.engine,
      templates,
      secretStore: store,
      children: repo,
    });

    expect(stored.get(PARENT_SECRET)).toEqual({
      access_token: "ghu_user2",
      refresh_token: "ghr_2",
    });
    const fullSecret = oauthAuthOf(rows.get(full)).accessTokenRef.path;
    expect(stored.get(fullSecret)!.access_token).toBe("ghu_user2");
    expect(stored.get(fullSecret)![API_SDS]).toContain("ghu_user2");
    const narrowedSecret = oauthAuthOf(rows.get(narrowed)).accessTokenRef.path;
    expect(stored.get(narrowedSecret)!.access_token).toBe("ghu_scoped_2");
    expect(
      github.calls.filter((c) => c.url.endsWith("/scoped")).at(-1)?.body,
    ).toMatchObject({ access_token: "ghu_user2" });
    expect(out.expiresAt).toBe(NOW_SEC + 1800);
  });

  // TEST_SCENARIO: when GitHub refuses one connection's scope, that connection reads expired while its sibling is still renewed, so one narrowing never costs the others their access.
  it("parks a refused connection without costing its sibling", async () => {
    const { svc, repo, rows, stored, store, github } = makeService();
    const narrowed = await svc.createFromParent(NARROWED);
    const full = await svc.createFromParent(FULL);
    github.state.refuseScoped = true;
    const parent = rows.get("conn-signin")!;

    await refreshOAuthAccessToken({
      conn: parent,
      auth: oauthAuthOf(parent),
      engine: refreshingEngine(),
      githubAppEngine: github.engine,
      templates,
      secretStore: store,
      children: repo,
    });

    expect((await svc.getConnection(narrowed))?.status).toBe("expired");
    expect((await svc.getConnection(full))?.status).toBe("active");
    const fullSecret = oauthAuthOf(rows.get(full)).accessTokenRef.path;
    expect(stored.get(fullSecret)!.access_token).toBe("ghu_user2");
  });
});

describe("GitHub sign-in — changing a connection made from it", () => {
  it("widens to full access only when asked for", async () => {
    const { svc, rows, stored } = makeService();
    const id = await svc.createFromParent(NARROWED);

    await svc.updateGitHubUserTokenScope({ id, fullAccess: true });

    const auth = oauthAuthOf(rows.get(id));
    expect(auth.fullAccess).toBe(true);
    expect(auth.githubUserTokenScope).toBeUndefined();
    expect(stored.get(auth.accessTokenRef.path)!.access_token).toBe("ghu_user");
  });

  it("narrows a full-access connection with a token derived for it", async () => {
    const { svc, rows, stored } = makeService();
    const id = await svc.createFromParent(FULL);

    await svc.updateGitHubUserTokenScope({ id, targetId: 42 });

    const auth = oauthAuthOf(rows.get(id));
    expect(auth.fullAccess).toBeUndefined();
    expect(auth.githubUserTokenScope).toMatchObject({ targetId: 42 });
    expect(stored.get(auth.accessTokenRef.path)!.access_token).toBe(
      "ghu_scoped_1",
    );
  });

  it("refuses an edit that names neither a scope nor full access", async () => {
    const { svc, rows } = makeService();
    const id = await svc.createFromParent(NARROWED);
    const before = rows.get(id)!.auth;

    await expect(svc.updateGitHubUserTokenScope({ id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: /full access/,
    });
    expect(rows.get(id)!.auth).toEqual(before);
  });

  it("refuses to narrow the sign-in itself", async () => {
    const { svc } = makeService();
    await expect(
      svc.updateGitHubUserTokenScope({ id: "conn-signin", targetId: 42 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // TEST_SCENARIO: what a connection can be narrowed to is read with the sign-in's user token, not with the connection's own narrowed token, which would hide everything outside its scope.
  it("reads what can be chosen with the sign-in's token", async () => {
    const { svc, github } = makeService();
    const id = await svc.createFromParent(NARROWED);

    const probe = await svc.probeGitHubUserTokenForConnection({
      connectionId: id,
    });

    expect(probe.installations.map((i) => i.accountLogin)).toEqual(["acme"]);
    expect(
      github.calls.filter((c) => c.url.includes("/user/installations?")).at(-1)
        ?.authorization,
    ).toBe("Bearer ghu_user");
  });

  it("keeps the credential on the sign-in", async () => {
    const { svc } = makeService();
    const id = await svc.createFromParent(NARROWED);
    await expect(
      svc.update(id, { value: "new-client-secret" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /sign-in/ });
  });
});

describe("GitHub sign-in — removal", () => {
  // TEST_SCENARIO: removing the sign-in removes every connection made from it, with their Secrets, and redelivers to every agent that held one, so no agent keeps a token from a sign-in that is gone.
  it("removes every connection made from it and tells their agents", async () => {
    const { svc, rows, stored, deleted, fannedOut } = makeService();
    const narrowed = await svc.createFromParent(NARROWED);
    const full = await svc.createFromParent(FULL);
    await svc.updateAgentConnections("agent-a", {
      grant: [narrowed],
      revoke: [],
    });
    await svc.updateAgentConnections("agent-b", { grant: [full], revoke: [] });
    const childSecrets = [narrowed, full].map(
      (id) => oauthAuthOf(rows.get(id)).accessTokenRef.path,
    );
    fannedOut.length = 0;

    await svc.deleteConnection("conn-signin");

    expect(rows.size).toBe(0);
    expect(deleted.sort()).toEqual([PARENT_SECRET, ...childSecrets].sort());
    expect(stored.size).toBe(0);
    expect(fannedOut.sort()).toEqual(["agent-a", "agent-b"]);
  });

  it("removes one connection and keeps the sign-in", async () => {
    const { svc, rows, stored, deleted } = makeService();
    const id = await svc.createFromParent(FULL);
    const own = oauthAuthOf(rows.get(id)).accessTokenRef.path;

    await svc.deleteConnection(id);

    expect([...rows.keys()]).toEqual(["conn-signin"]);
    expect(deleted).toEqual([own]);
    expect(stored.get(PARENT_SECRET)!.refresh_token).toBe("ghr_1");
  });

  // TEST_SCENARIO: a connection split from an older sign-in keeps the Secret it shares with the sign-in; removing it clears its own token there and leaves the sign-in's tokens, so the sign-in still renews.
  it("clears a shared Secret's own token when a split connection is removed", async () => {
    const parent = signIn();
    const split: Connection = {
      ...parent,
      id: "conn-split",
      isParent: undefined,
      parentId: parent.id,
      auth: {
        ...(parent.auth as OAuthAuth),
        refreshTokenRef: undefined,
        accessTokenRef: ref(PARENT_SECRET, "scoped_token"),
        fullAccess: true,
      },
    };
    delete split.isParent;
    const { svc, rows, stored, deleted } = makeService([parent, split]);
    stored.set(PARENT_SECRET, {
      access_token: "ghu_user",
      refresh_token: "ghr_1",
      scoped_token: "ghu_user",
      [API_SDS]: "Bearer ghu_user",
    });

    await svc.deleteConnection("conn-split");

    expect([...rows.keys()]).toEqual(["conn-signin"]);
    expect(deleted).toEqual([]);
    expect(stored.get(PARENT_SECRET)).toMatchObject({
      access_token: "ghu_user",
      refresh_token: "ghr_1",
      scoped_token: "",
    });
    expect(stored.get(PARENT_SECRET)![API_SDS]).toContain(
      CONNECTION_TOKEN_PLACEHOLDER,
    );
  });
});

describe("GitHub sign-in — signing in again", () => {
  function makeFlow(initial: Connection[]) {
    const { repo, rows } = makeRepo(initial);
    const secrets = makeSecretStore();
    const github = makeGitHub();
    const pending: PendingFlow<OAuthFlowPendingCtx> = {
      provider: {
        id: "connection:conn-signin:github",
        authorizationUrl: "https://github.com/login/oauth/authorize",
        tokenEndpoint: "https://github.com/login/oauth/access_token",
        clientId: "Iv1.client",
        clientSecret: "shh",
        scopes: [],
      },
      ctx: {
        connectionId: "conn-signin",
        ownerId: OWNER,
        accessTokenRef: ref(PARENT_SECRET, "access_token"),
        refreshTokenRef: ref(PARENT_SECRET, "refresh_token"),
      },
      codeVerifier: "v",
      redirectUri: "https://cb.example/oauth/callback",
      state: "s",
      createdAt: NOW_MS,
    };
    const engine = {
      consume: async () => pending,
      exchange: async () => ({
        accessToken: "ghu_fresh",
        refreshToken: "ghr_fresh",
        expiresAt: NOW_SEC + 28_800,
      }),
    } as unknown as OAuthEngine;
    const runtimeMutator = {
      bump: async () => 1,
      enqueueAfterCommit: async () => {},
    } as unknown as RuntimeMutator;
    const flow = createOAuthFlowService({
      engine,
      githubAppEngine: github.engine,
      repo,
      templates,
      secretStore: secrets.store,
      runtimeMutator,
      ownerId: OWNER,
      callbackUrl: "https://cb.example/oauth/callback",
      connectionLock: <T>(_key: string, fn: () => Promise<T>): Promise<T> =>
        fn(),
    });
    return { flow, rows, ...secrets };
  }

  // TEST_SCENARIO: signing in again lands the new tokens on the sign-in alone, never as an injection of the sign-in, and gives each connection made from it a token from the new user token.
  it("stores the new tokens at rest and renews the connections made from it", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ login: "octocat", id: 1, name: null, email: null }),
    );
    const parent = signIn();
    const full: Connection = {
      ...parent,
      id: "conn-full",
      name: "github-full",
      parentId: parent.id,
      auth: {
        ...(parent.auth as OAuthAuth),
        refreshTokenRef: undefined,
        accessTokenRef: ref("secret-full", "access_token"),
        fullAccess: true,
      },
    };
    delete full.isParent;
    const { flow, rows, stored } = makeFlow([parent, full]);
    stored.set("secret-full", { access_token: "ghu_user" });

    await flow.completeOAuth("s", "code");

    expect(stored.get(PARENT_SECRET)).toEqual({
      access_token: "ghu_fresh",
      refresh_token: "ghr_fresh",
    });
    expect(stored.get("secret-full")!.access_token).toBe("ghu_fresh");
    expect(stored.get("secret-full")![API_SDS]).toContain("ghu_fresh");
    expect(oauthAuthOf(rows.get(parent.id)).expiresAt).toBe(NOW_SEC + 28_800);
    expect(oauthAuthOf(rows.get(full.id)).expiresAt).toBe(NOW_SEC + 28_800);
  });

  // TEST_SCENARIO: a sign-in split by the migration keeps its old scope only so an older api-server renewing it during the rollout still derives the narrowed token; the first sign-in through this release drops it, so the scope lives on the connection alone.
  it("drops a scope left on a split sign-in", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ login: "octocat", id: 1, name: null, email: null }),
    );
    const split = signIn();
    const { flow, rows } = makeFlow([
      {
        ...split,
        auth: {
          ...(split.auth as OAuthAuth),
          githubUserTokenScope: { targetId: 42 },
        },
      },
    ]);

    await flow.completeOAuth("s", "code");

    expect(
      oauthAuthOf(rows.get(split.id)).githubUserTokenScope,
    ).toBeUndefined();
  });

  it("refuses to sign in on a connection made from a sign-in", async () => {
    const parent = signIn();
    const child: Connection = {
      ...parent,
      id: "conn-child",
      parentId: parent.id,
    };
    delete child.isParent;
    const { flow } = makeFlow([parent, child]);
    await expect(flow.startOAuth("conn-child")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
