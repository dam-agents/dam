import { TRPCError } from "@trpc/server";
import type { Connection, ConnectionCreateInput } from "api-server-api";
import { describe, expect, it, vi } from "vitest";

import { configureLogger } from "../../core/logger.js";
import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
import type {
  PendingSecretRequest,
  SecretRequestOutcome,
} from "../../modules/connections/domain/secret-request.js";
import {
  createSecretRequestsService,
  SECRET_REQUEST_TTL_MS,
} from "../../modules/connections/services/secret-requests.js";

/**
 * TEST_OVERVIEW: a Secret Request lets the user's agent run `dam connection
 * connect` or `update` itself while the user types the secret on a page of
 * the web app. The request holds every non-secret input, the page shows where
 * the secret will go, only the user who made the request can see it or
 * submit it, a request is used once, and the status the CLI polls never
 * carries the secret.
 */

configureLogger({ level: "error", write: () => {} });

const templates = createConnectionTemplateRegistry(buildCatalog());

function world(
  opts: {
    clock?: { now: number };
    connections?: Connection[];
    grants?: Record<string, string[]>;
    createFromTemplate?: (input: ConnectionCreateInput) => Promise<string>;
  } = {},
) {
  const clock = opts.clock ?? { now: 1_000_000 };
  const pending = createMemoryTtlStore<PendingSecretRequest>(
    SECRET_REQUEST_TTL_MS,
    () => clock.now,
  );
  const outcomes = createMemoryTtlStore<SecretRequestOutcome>(
    SECRET_REQUEST_TTL_MS,
    () => clock.now,
  );
  const createFromTemplate = vi.fn(
    opts.createFromTemplate ?? (async () => "conn-000000000001"),
  );
  const update = vi.fn(async () => {});
  const forOwner = (ownerId: string) =>
    createSecretRequestsService({
      ownerId,
      uiBaseUrl: "https://dam.example.com",
      pending,
      outcomes,
      templates,
      repo: {
        get: async (id, owner) =>
          opts.connections?.find((c) => c.id === id && c.ownerId === owner) ??
          null,
        listAgentsForConnection: async (id) => opts.grants?.[id] ?? [],
      },
      connections: { createFromTemplate, update },
      agentName: async (id) => (id === "agent-1" ? "reviewer" : null),
      now: () => clock.now,
    });
  return { forOwner, createFromTemplate, update, clock };
}

const githubPat = {
  action: "create",
  connection: {
    templateId: "github-pat",
    name: "my-github",
    authKind: "header",
  },
} as const;

describe("secret requests", () => {
  // TEST_SCENARIO: the CLI gets a link to the web app that carries only a random id, and the page shows the template, the name and every host the token will be sent to with its header, before the user types anything.
  it("returns a link and shows where the secret will go", async () => {
    const w = world();
    const alice = w.forOwner("alice");
    const ticket = await alice.request(githubPat);
    expect(ticket.url).toBe(
      `https://dam.example.com/connections/secret?request=${ticket.requestId}`,
    );
    expect(ticket.requestId).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const view = await alice.get(ticket.requestId);
    expect(view).toMatchObject({
      action: "create",
      connectionName: "my-github",
      templateName: "GitHub (Personal Access Token)",
      authKind: "header",
      unexpectedHosts: [],
      customDestination: false,
      envNames: ["GH_TOKEN"],
      fields: [{ name: "value", label: "Secret value" }],
    });
    expect(view!.destinations).toEqual([
      {
        host: "api.github.com",
        headerName: "Authorization",
        valueFormat: "Bearer {value}",
      },
      {
        host: "github.com",
        headerName: "Authorization",
        valueFormat: "Basic {value}",
      },
      {
        host: "raw.githubusercontent.com",
        headerName: "Authorization",
        valueFormat: "Bearer {value}",
      },
    ]);
    expect(await alice.status(ticket.requestId)).toEqual({
      status: "pending",
    });
  });

  // TEST_SCENARIO: an agent or a prompt injection may point a GitHub token at another host; the page names that host so the user can see the token would leave GitHub.
  it("names a destination the template does not preset", async () => {
    const w = world();
    const alice = w.forOwner("alice");
    const ticket = await alice.request({
      action: "create",
      connection: { ...githubPat.connection, host: "evil.example" },
    });
    const view = await alice.get(ticket.requestId);
    expect(view!.unexpectedHosts).toEqual(["evil.example"]);
  });

  // TEST_SCENARIO: an attacker who makes a request on their own account and sends the link must not collect the victim's token, so another signed-in user can neither see nor submit it, and the attacker's request stays pending.
  it("refuses another user's request", async () => {
    const w = world();
    const ticket = await w.forOwner("attacker").request(githubPat);
    const victim = w.forOwner("victim");

    await expect(victim.get(ticket.requestId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      victim.submit({
        requestId: ticket.requestId,
        fields: { value: "ghp_victim" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(victim.cancel(ticket.requestId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(w.createFromTemplate).not.toHaveBeenCalled();
    expect(await victim.status(ticket.requestId)).toEqual({
      status: "expired",
    });
    expect(await w.forOwner("attacker").status(ticket.requestId)).toEqual({
      status: "pending",
    });
  });

  // TEST_SCENARIO: the submit creates the connection with the stored inputs and the typed secret, the status then says saved with the id and nothing else, and the link cannot be used again.
  it("creates the connection once and reports saved", async () => {
    const w = world();
    const alice = w.forOwner("alice");
    const ticket = await alice.request(githubPat);

    await expect(
      alice.submit({
        requestId: ticket.requestId,
        fields: { value: " ghp_x " },
      }),
    ).resolves.toEqual({ connectionId: "conn-000000000001" });
    expect(w.createFromTemplate).toHaveBeenCalledWith({
      ...githubPat.connection,
      value: "ghp_x",
    });
    expect(await alice.status(ticket.requestId)).toEqual({
      status: "saved",
      connectionId: "conn-000000000001",
    });
    await expect(
      alice.submit({ requestId: ticket.requestId, fields: { value: "again" } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(w.createFromTemplate).toHaveBeenCalledTimes(1);
  });

  // TEST_SCENARIO: a secret the provider refuses must not burn the link, so the user can correct it on the same page while the request is still live.
  it("keeps the request when the create fails", async () => {
    const w = world({
      createFromTemplate: async () => {
        throw new TRPCError({ code: "BAD_REQUEST", message: "bad token" });
      },
    });
    const alice = w.forOwner("alice");
    const ticket = await alice.request(githubPat);
    await expect(
      alice.submit({ requestId: ticket.requestId, fields: { value: "bad" } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "bad token" });
    expect(await alice.status(ticket.requestId)).toEqual({
      status: "pending",
    });
  });

  // TEST_SCENARIO: the page takes exactly the fields of the auth kind, so a request for a key pair needs both keys and no other field reaches the connection.
  it("takes the fields of the auth kind only", async () => {
    const w = world();
    const alice = w.forOwner("alice");
    const ticket = await alice.request({
      action: "create",
      connection: {
        templateId: "s3-compatible",
        name: "bucket",
        authKind: "sigv4",
        endpoint: "https://s3.example.com",
      },
    });
    expect((await alice.get(ticket.requestId))!.destinations).toEqual([
      { host: "s3.example.com", signed: true },
    ]);
    await expect(
      alice.submit({
        requestId: ticket.requestId,
        fields: { accessKeyId: "AKIA" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      alice.submit({
        requestId: ticket.requestId,
        fields: { accessKeyId: "AKIA", secretAccessKey: "s", host: "x" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await alice.submit({
      requestId: ticket.requestId,
      fields: { accessKeyId: "AKIA", secretAccessKey: "s" },
    });
    expect(w.createFromTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ accessKeyId: "AKIA", secretAccessKey: "s" }),
    );
  });

  // TEST_SCENARIO: a rotation shows the stored connection, the agents it is granted to, and rotates its credential through the same update path as the CLI.
  it("rotates an existing connection's credential", async () => {
    const conn: Connection = {
      id: "conn-abc",
      ownerId: "alice",
      templateId: "github-app",
      name: "bot",
      inputs: {},
      auth: {
        kind: "github-app",
        appId: "1",
        installationId: "2",
        privateKeyRef: { path: "p", field: "private_key" },
        accessTokenRef: { path: "p", field: "access_token" },
        apiBaseUrl: "https://api.github.com",
      },
      contributions: [
        {
          kind: "egress-inject",
          host: "api.github.com",
          headerName: "Authorization",
          valueFormat: "Bearer {value}",
        },
      ],
    };
    const w = world({
      connections: [conn],
      grants: { "conn-abc": ["agent-1"] },
    });
    const alice = w.forOwner("alice");
    const ticket = await alice.request({
      action: "update",
      connectionId: "conn-abc",
    });
    expect(await alice.get(ticket.requestId)).toMatchObject({
      action: "update",
      connectionId: "conn-abc",
      grantedAgents: [{ id: "agent-1", name: "reviewer" }],
      fields: [{ name: "privateKey", multiline: true }],
    });
    await alice.submit({
      requestId: ticket.requestId,
      fields: { privateKey: "PEM" },
    });
    expect(w.update).toHaveBeenCalledWith("conn-abc", { value: "PEM" });
    await expect(
      w.forOwner("bob").request({ action: "update", connectionId: "conn-abc" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // TEST_SCENARIO: an OAuth connection signs in through the browser and takes no secret here, so a request for one is refused rather than sending the user to a page with nothing to type.
  it("refuses a connection that takes no secret on the page", async () => {
    const w = world({
      connections: [
        {
          id: "conn-mcp",
          ownerId: "alice",
          templateId: "custom-mcp-none",
          name: "mcp",
          inputs: {},
          auth: { kind: "none" },
          contributions: [],
        },
      ],
    });
    await expect(
      w
        .forOwner("alice")
        .request({ action: "update", connectionId: "conn-mcp" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // TEST_SCENARIO: a link stops working after ten minutes, and the CLI reads that as expired rather than waiting forever.
  it("expires after the time limit", async () => {
    const clock = { now: 0 };
    const w = world({ clock });
    const alice = w.forOwner("alice");
    const ticket = await alice.request(githubPat);
    clock.now = SECRET_REQUEST_TTL_MS + 1;
    expect(await alice.status(ticket.requestId)).toEqual({
      status: "expired",
    });
    await expect(alice.get(ticket.requestId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  // TEST_SCENARIO: the user can turn the request down on the page, and the CLI then stops waiting with a cancelled status.
  it("reports a cancelled request", async () => {
    const w = world();
    const alice = w.forOwner("alice");
    const ticket = await alice.request(githubPat);
    await alice.cancel(ticket.requestId);
    expect(await alice.status(ticket.requestId)).toEqual({
      status: "cancelled",
    });
    await expect(alice.get(ticket.requestId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  // TEST_SCENARIO: inputs the builder would refuse fail when the CLI makes the request, not after the user typed the secret.
  it("refuses an input the connection builder refuses", async () => {
    const w = world();
    await expect(
      w.forOwner("alice").request({
        action: "create",
        connection: {
          templateId: "s3-compatible",
          name: "bucket",
          authKind: "sigv4",
          endpoint: "http://s3.example.com",
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
