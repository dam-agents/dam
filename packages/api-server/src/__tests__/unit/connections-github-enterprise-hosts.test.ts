import { describe, expect, it } from "vitest";
import type { Connection, SecretRef } from "api-server-api";

import { buildConnection } from "../../modules/connections/domain/build-connection.js";
import {
  buildCatalog,
  type OperatorCredentials,
} from "../../modules/connections/domain/catalog.js";
import {
  createConnectionTemplateRegistry,
  templateToView,
} from "../../modules/connections/domain/connection-template.js";
import { sdsFileKeyForHost } from "../../modules/connections/domain/connection-sds.js";
import { resolveOAuthClientSecret } from "../../modules/connections/services/oauth-token.js";
import { createOAuthFlowService } from "../../modules/connections/services/oauth-flow.js";
import type { ConnectionsRepository } from "../../modules/connections/infrastructure/connections-repository.js";
import {
  newConnectionsStore,
  serviceHarness,
  unused,
} from "../helpers/connections-service.js";

/**
 * TEST_OVERVIEW: an install can offer several GitHub Enterprise hosts, each
 * with the GitHub app registered on it, and retire a host its users moved
 * away from. The connect form asks which host, and a sign-in on a host uses
 * that host's app. A connection on a retired host stays, reads disconnected,
 * and cannot be authorized there; moving it to an offered host rewrites where
 * its credential is injected, for the sign-in and every connection made from
 * it, and leaves it waiting for an authorization on the new host.
 */

const OLD = "github.ibm.com";
const NEW = "research.github.ibm.com";
const OTHER = "consulting.github.ibm.com";

const CREDS: OperatorCredentials = {
  githubEnterprise: {
    host: OLD,
    clientId: "Iv1.old",
    clientSecret: "old-secret",
    appSlug: "dam-old",
    hosts: [
      {
        host: NEW,
        clientId: "Iv1.research",
        clientSecret: "research-secret",
        appSlug: "dam-research",
      },
      { host: OTHER, clientId: "Iv1.consulting" },
    ],
    retiredHosts: [OLD],
  },
};

const CALLBACK = "https://cb.example/oauth/callback";

function gheTemplate(creds: OperatorCredentials = CREDS) {
  const t = buildCatalog(creds).find((t) => t.id === "github-enterprise");
  if (t?.authKind !== "oauth") throw new Error("github-enterprise missing");
  return t;
}

function mintRef(purpose: string): SecretRef {
  return { storeId: "test", path: `secret-${purpose}`, field: "" };
}

function build(host: string, creds: OperatorCredentials = CREDS) {
  return buildConnection(
    gheTemplate(creds),
    {
      templateId: "github-enterprise",
      name: "ghe",
      authKind: "oauth",
      host,
    },
    mintRef,
    CALLBACK,
    "Test",
  );
}

const ref = (path: string, field: string): SecretRef => ({
  storeId: "test",
  path,
  field,
});

function contributionsOn(host: string): Connection["contributions"] {
  return [
    { kind: "env", name: "GH_TOKEN", placeholder: "dummy-placeholder" },
    { kind: "env", name: "GH_HOST", placeholder: host },
    {
      kind: "egress-inject",
      host: `api.${host}`,
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
    },
    {
      kind: "egress-inject",
      host,
      headerName: "Authorization",
      valueFormat: "Basic {value}",
      encoding: "basic-x-access-token",
    },
  ];
}

function signInOn(host: string): Connection {
  return {
    id: "conn-signin",
    ownerId: "owner",
    templateId: "github-enterprise",
    name: "ghe",
    inputs: { host },
    isParent: true,
    auth: {
      kind: "oauth",
      clientId: "Iv1.old",
      refreshTokenRef: ref("secret-signin", "refresh_token"),
      accessTokenRef: ref("secret-signin", "access_token"),
      scopes: [],
      authorizationUrl: `https://${host}/login/oauth/authorize`,
      tokenUrl: `https://${host}/login/oauth/access_token`,
      tokenEndpointAcceptJson: true,
      host,
      appSlug: "dam-old",
      connectedAt: 1_700_000_000,
      expiresAt: 1_700_028_000,
    },
    contributions: contributionsOn(host),
  };
}

function childOn(host: string): Connection {
  return {
    id: "conn-child",
    ownerId: "owner",
    templateId: "github-enterprise",
    name: "ghe-docs",
    inputs: {},
    parentId: "conn-signin",
    auth: {
      kind: "oauth",
      clientId: "Iv1.old",
      accessTokenRef: ref("secret-child", "access_token"),
      scopes: [],
      authorizationUrl: `https://${host}/login/oauth/authorize`,
      tokenUrl: `https://${host}/login/oauth/access_token`,
      host,
      fullAccess: true,
      connectedAt: 1_700_000_000,
    },
    contributions: contributionsOn(host),
  };
}

function harness(rows: Connection[]) {
  const store = newConnectionsStore();
  for (const row of rows) store.rows.set(row.id, row);
  store.secrets.set("secret-signin", {
    fields: { access_token: "ghu_old", refresh_token: "ghr_old" },
    annotations: {},
    purpose: "connection:github-enterprise",
  });
  store.secrets.set("secret-child", {
    fields: { access_token: "ghu_old" },
    annotations: {},
    purpose: "connection:github-enterprise",
  });
  return serviceHarness({
    templates: createConnectionTemplateRegistry(buildCatalog(CREDS)),
    store,
    brandName: "Test",
  });
}

describe("the GitHub Enterprise hosts an install offers", () => {
  // TEST_SCENARIO: the connect form must name every host a user may pick and leave out the retired one, and must not show one host's app as the preset for all of them.
  it("offers each live host as a choice, and no single app as the preset", () => {
    const view = templateToView(gheTemplate(), CALLBACK);
    expect(view.extras?.hostChoices).toEqual([NEW, OTHER]);
    expect(view.inputs.find((i) => i.name === "host")).toMatchObject({
      state: "required",
      presetValue: NEW,
    });
    const clientId = view.inputs.find((i) => i.name === "clientId");
    expect(clientId).toMatchObject({ state: "overridable" });
    expect(clientId?.presetValue).toBeUndefined();
  });

  // TEST_SCENARIO: an install with one host and no list keeps the form it had before, with that host and its app as presets.
  it("keeps the single-host form when the install names one host", () => {
    const view = templateToView(
      gheTemplate({
        githubEnterprise: { host: OLD, clientId: "Iv1.old", appSlug: "dam" },
      }),
      CALLBACK,
    );
    expect(view.extras?.hostChoices).toEqual([OLD]);
    expect(view.inputs.find((i) => i.name === "host")).toMatchObject({
      state: "overridable",
      presetValue: OLD,
    });
    expect(view.inputs.find((i) => i.name === "clientId")).toMatchObject({
      state: "overridable",
      presetValue: "Iv1.old",
    });
  });

  // TEST_SCENARIO: each host has its own app registration, so a sign-in on a host must authorize with that host's client id and offer that host's app installation.
  it("signs in on each host through the app registered there", async () => {
    const research = await build(NEW);
    expect(research.auth).toMatchObject({
      kind: "oauth",
      clientId: "Iv1.research",
      appSlug: "dam-research",
      host: NEW,
      authorizationUrl: `https://${NEW}/login/oauth/authorize`,
    });
    const consulting = await build(`https://${OTHER.toUpperCase()}`);
    expect(consulting.auth).toMatchObject({ clientId: "Iv1.consulting" });
    expect(
      consulting.auth.kind === "oauth" && consulting.auth.appSlug,
    ).toBeFalsy();
  });

  // TEST_SCENARIO: a host the install did not register an app on has no client id to sign in with; the error must say which hosts can be used.
  it("explains a host with no registered app", async () => {
    await expect(build("ghe.elsewhere.example")).rejects.toThrow(
      /No GitHub app is registered for ghe\.elsewhere\.example/,
    );
  });

  // TEST_SCENARIO: once a host is retired nobody may make a new connection to it, by sign-in, token or app installation.
  it("refuses a new connection on a retired host", async () => {
    await expect(build(OLD)).rejects.toThrow(/retired/);
    const pat = buildCatalog(CREDS).find(
      (t) => t.id === "github-enterprise-pat",
    )!;
    await expect(
      buildConnection(
        pat,
        {
          templateId: pat.id,
          name: "ghe-pat",
          authKind: "header",
          host: OLD,
          value: "ghp_x",
        },
        mintRef,
        CALLBACK,
        "Test",
      ),
    ).rejects.toThrow(/retired/);
  });

  // TEST_SCENARIO: the client secret used to renew a sign-in must be the one of the app on that sign-in's host, not the first host's.
  it("renews a sign-in with the client secret of its host's app", async () => {
    const templates = createConnectionTemplateRegistry(buildCatalog(CREDS));
    const conn = signInOn(NEW);
    if (conn.auth.kind !== "oauth") throw new Error("not oauth");
    await expect(
      resolveOAuthClientSecret({
        conn,
        auth: conn.auth,
        templates,
        secretStore: unused(),
      }),
    ).resolves.toBe("research-secret");
  });
});

describe("a connection on a retired host", () => {
  // TEST_SCENARIO: the connection must not be deleted or shown as working when its host goes away; it reads disconnected so its owner knows to move it.
  it("reads disconnected, the sign-in and what was made from it", async () => {
    const { svc } = harness([signInOn(OLD), childOn(OLD)]);
    const views = await svc.listConnections();
    expect(views.map((v) => [v.id, v.status])).toEqual([
      ["conn-signin", "disconnected"],
      ["conn-child", "disconnected"],
    ]);
  });

  // TEST_SCENARIO: authorizing on the retired host would only fail at GitHub; the platform refuses first and says what to do.
  it("cannot be authorized on the retired host", async () => {
    const { rows } = harness([signInOn(OLD)]);
    const flow = createOAuthFlowService({
      engine: unused(),
      githubAppEngine: unused(),
      repo: unused<ConnectionsRepository>({
        get: async (id) => rows.get(id) ?? null,
      }),
      templates: createConnectionTemplateRegistry(buildCatalog(CREDS)),
      secretStore: unused(),
      runtimeMutator: unused(),
      ownerId: "owner",
      callbackUrl: CALLBACK,
      connectionLock: unused(),
    });
    await expect(flow.startOAuth("conn-signin")).rejects.toThrow(
      /retired on this platform\. Move this sign-in/,
    );
  });
});

describe("moving a GitHub Enterprise sign-in to another host", () => {
  // TEST_SCENARIO: the user keeps the sign-in, its name, its grants and every connection made from it; the credential is injected on the new host only, the old host's token is gone, and the sign-in waits for an authorization on the new host.
  it("repoints the sign-in and its connections, and drops the old token", async () => {
    const { svc, rows, secrets, fannedOut } = harness([
      signInOn(OLD),
      childOn(OLD),
    ]);
    await svc.moveToHost({ id: "conn-signin", host: NEW });

    for (const id of ["conn-signin", "conn-child"]) {
      const moved = rows.get(id)!;
      expect(moved.auth).toMatchObject({
        kind: "oauth",
        host: NEW,
        clientId: "Iv1.research",
        authorizationUrl: `https://${NEW}/login/oauth/authorize`,
        tokenUrl: `https://${NEW}/login/oauth/access_token`,
      });
      expect(moved.auth.kind === "oauth" && moved.auth.expiresAt).toBeFalsy();
      const hosts = moved.contributions.flatMap((c) =>
        c.kind === "egress-inject" ? [c.host] : [],
      );
      expect(hosts).toEqual([`api.${NEW}`, NEW]);
      expect(
        moved.contributions.find(
          (c) => c.kind === "env" && c.name === "GH_HOST",
        ),
      ).toMatchObject({ placeholder: NEW });
    }
    expect(rows.get("conn-child")!.auth).toMatchObject({ fullAccess: true });
    expect(rows.get("conn-signin")!.auth).toMatchObject({
      appSlug: "dam-research",
    });

    expect(secrets.get("secret-signin")!.fields.access_token).toBe("");
    const child = secrets.get("secret-child")!;
    expect(child.fields.access_token).toBe("");
    expect(Object.keys(child.fields)).toContain(sdsFileKeyForHost(NEW));
    expect(Object.keys(child.fields)).not.toContain(sdsFileKeyForHost(OLD));
    expect(child.annotations["agent-platform.ai/injection-hosts"]).toContain(
      NEW,
    );
    expect(fannedOut).toContain("agent-1");

    const views = await svc.listConnections();
    expect(views.map((v) => v.status)).toEqual(["expired", "expired"]);
  });

  // TEST_SCENARIO: a move a failed write left halfway, the sign-in already on the new host and a connection made from it still on the old one, must finish when the user retries it; else that connection stays stranded on the retired host.
  it("finishes a move left halfway when retried", async () => {
    const { svc, rows, secrets } = harness([signInOn(OLD), childOn(OLD)]);
    await svc.moveToHost({ id: "conn-signin", host: NEW });
    rows.set("conn-child", childOn(OLD));
    secrets.get("secret-child")!.fields.access_token = "ghu_old";

    await svc.moveToHost({ id: "conn-signin", host: NEW });

    expect(rows.get("conn-child")!.auth).toMatchObject({
      host: NEW,
      clientId: "Iv1.research",
    });
    expect(secrets.get("secret-child")!.fields.access_token).toBe("");
    expect(rows.get("conn-signin")!.auth).toMatchObject({ host: NEW });
  });

  // TEST_SCENARIO: a sign-in may only move to a host the install offers, and a connection made from a sign-in moves with it, never alone.
  it("refuses a host the install does not offer, and a connection made from a sign-in", async () => {
    const { svc } = harness([signInOn(OLD), childOn(OLD)]);
    await expect(
      svc.moveToHost({ id: "conn-signin", host: OLD }),
    ).rejects.toThrow(/not a GitHub Enterprise host this platform offers/);
    await expect(
      svc.moveToHost({ id: "conn-signin", host: "ghe.elsewhere.example" }),
    ).rejects.toThrow(/not a GitHub Enterprise host/);
    await expect(
      svc.moveToHost({ id: "conn-child", host: NEW }),
    ).rejects.toThrow(/Move the sign-in/);
  });
});
