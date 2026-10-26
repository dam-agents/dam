// TEST_OVERVIEW: A GitHub sign-in or GitHub App installation holds the credential, and agents are granted only the connections made from it. `dam connection connect --from <sign-in or installation>` makes another connection next to those it has, with a scope or an explicit --full-access, and takes a free name by default. `dam connection connect github-app` passes the scope or `fullAccess: true` in its create input and reports the connection made with the installation, or the installation alone. A name that a sign-in and a connection share means the connection; the sign-in is reached by its id. `grant` refuses a sign-in or installation and names its connections, `reauth` of a connection signs in again for its sign-in, and `update` of a connection points at the installation that holds its key.
import { describe, expect, it, vi } from "vitest";
import type {
  ConnectionTemplateView,
  GitHubAppInstallationProbe,
} from "api-server-api";
import type { AgentView } from "../modules/agent/domain/agent-view.js";
import { buildConnectCommand } from "../modules/connection/commands/connect.js";
import { buildGrantCommand } from "../modules/connection/commands/grant.js";
import { buildReauthCommand } from "../modules/connection/commands/reauth.js";
import { buildUpdateCommand } from "../modules/connection/commands/update.js";
import {
  resolveConnectionRef,
  unresolvedConnectionRef,
} from "../modules/connection/domain/connection-ref.js";
import type { ConnectionService } from "../modules/connection/services/connection-service.js";
import { EXIT_INVALID_INPUT } from "../modules/shared/exit-codes.js";
import {
  app,
  captureOutput,
  deps,
  docsChild,
  FULL_SIGN_IN,
  fullChild,
  installation,
  ok,
  output,
  probe,
  run,
  signIn,
  slack,
} from "./connection-commands.js";

captureOutput();

const appProbe: GitHubAppInstallationProbe = {
  permissions: { contents: "write", issues: "write" },
  repositories: [{ id: 1, name: "api" }],
  repositorySelection: "selected",
};

const readFailed = {
  ok: false as const,
  error: { kind: "transport" as const, reason: "socket hang up" },
};

describe("connection refs", () => {
  /** TEST_SCENARIO: a sign-in and its first connection share a name, and the name means the connection, the one an agent can be granted. */
  it("resolves a shared name to the connection", () => {
    expect(resolveConnectionRef([signIn, fullChild], "github")?.id).toBe(
      "conn-gh",
    );
    expect(resolveConnectionRef([signIn, fullChild], "conn-signin")?.id).toBe(
      "conn-signin",
    );
    expect(resolveConnectionRef([signIn], "github")?.id).toBe("conn-signin");
  });

  /** TEST_SCENARIO: two sign-ins of one name and no connection of that name can't be told apart by name, so neither is picked and the error lists their ids. */
  it("picks no sign-in when several share the name", () => {
    const other = { ...signIn, id: "conn-signin2" };
    expect(resolveConnectionRef([signIn, other], "github")).toBeNull();
    expect(unresolvedConnectionRef([signIn, other], "github")).toContain(
      "pass the id of one: conn-signin, conn-signin2",
    );
  });
});

describe("dam connection connect --from", () => {
  const connect = (svc: Partial<ConnectionService>) =>
    buildConnectCommand(
      deps({
        list: async () => ok([signIn, fullChild, installation, app, slack]),
        probeGitHubUserToken: async () => ok(probe),
        ...svc,
      }),
    );

  /** TEST_SCENARIO: --from takes the sign-in by the name it shares with its first connection, and the new connection takes the next free name instead of replacing the one the sign-in has. */
  it("makes another connection from a sign-in", async () => {
    const make = vi.fn(async () => ok({ id: "conn-new" }));
    const out = await run(
      connect({
        createFromParent: make,
        getConnection: async () =>
          ok({ ...docsChild, id: "conn-new", name: "github-2" }),
      }),
      ["--from", "github", "--account", "acme", "--repositories", "web"],
    );
    expect(make).toHaveBeenCalledWith({
      parentId: "conn-signin",
      name: "github-2",
      targetId: 11,
      repositoryIds: "102",
    });
    expect(out).toContain(
      "✓ Created github-2 (conn-new) from the GitHub sign-in github (conn-signin)",
    );
    expect(out).toContain("scope: account acme; repos web; all perms");
  });

  /** TEST_SCENARIO: from an App installation, --full-access is sent as an explicit `fullAccess: true`, and a scope as the repositories and permissions; no account applies there. */
  it("makes a connection from an installation", async () => {
    const make = vi.fn(async () => ok({ id: "conn-all" }));
    const out = await run(
      connect({
        createFromParent: make,
        getConnection: async () =>
          ok({
            ...app,
            id: "conn-all",
            name: "my-app-all",
            githubAppScope: undefined,
            fullAccess: true as const,
          }),
      }),
      [
        "--from",
        "conn-inst",
        "--full-access",
        "--name",
        "my-app-all",
        "--json",
      ],
    );
    expect(make).toHaveBeenCalledWith({
      parentId: "conn-inst",
      name: "my-app-all",
      fullAccess: true,
    });
    expect(JSON.parse(out)).toMatchObject({
      ok: true,
      id: "conn-all",
      parentId: "conn-inst",
      scope: { restricted: false, fullAccess: true },
    });

    const scoped = vi.fn(async () => ok({ id: "conn-api" }));
    await run(
      connect({
        createFromParent: scoped,
        getConnection: async () => ok(app),
      }),
      ["--from", "my-app", "--repositories", "api"],
    );
    expect(scoped).toHaveBeenCalledWith({
      parentId: "conn-inst",
      name: "my-app-2",
      repositories: "api",
    });
  });

  /** TEST_SCENARIO: a connection made with --from reaches what the user chose, never everything by default, so a scope or --full-access is required before anything is read. */
  it("needs a scope or --full-access", async () => {
    const list = vi.fn();
    await run(connect({ list }), ["--from", "github"], EXIT_INVALID_INPUT);
    expect(list).not.toHaveBeenCalled();
    expect(output.stderr).toContain("or --full-access");
  });

  /** TEST_SCENARIO: --from given a connection made from a sign-in names that sign-in, so the user doesn't read it as copying the connection's scope. */
  it("refuses a connection and names its sign-in", async () => {
    const make = vi.fn();
    await run(
      connect({
        list: async () => ok([signIn, fullChild, docsChild]),
        createFromParent: make,
      }),
      ["--from", "github-docs", "--full-access"],
      EXIT_INVALID_INPUT,
    );
    expect(make).not.toHaveBeenCalled();
    expect(output.stderr).toContain(
      "made from the GitHub sign-in github (conn-signin)",
    );
    expect(output.stderr).toContain(
      "dam connection connect --from conn-signin",
    );

    await run(
      connect({ createFromParent: make }),
      ["--from", "slack", "--full-access"],
      EXIT_INVALID_INPUT,
    );
    expect(output.stderr).toContain(
      "is not a GitHub sign-in or GitHub App installation",
    );
  });

  /** TEST_SCENARIO: a --name another connection has is refused before the server is asked, and a provider with --from is refused as ambiguous. */
  it("refuses a taken name and a provider with --from", async () => {
    const make = vi.fn();
    await run(
      connect({
        list: async () => ok([signIn, fullChild, docsChild]),
        createFromParent: make,
      }),
      ["--from", "github", "--full-access", "--name", "github-docs"],
      EXIT_INVALID_INPUT,
    );
    expect(output.stderr).toContain("a connection named 'github-docs' exists");

    await run(
      connect({ createFromParent: make }),
      ["github", "--from", "github", "--full-access"],
      EXIT_INVALID_INPUT,
    );
    expect(make).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: when the new connection can't be read back after it is made, the output shows what was sent, full access included, and says the read failed. */
  it("shows what was sent when the connection can't be read back", async () => {
    const out = await run(
      connect({
        createFromParent: async () => ok({ id: "conn-new" }),
        getConnection: async () => readFailed,
      }),
      ["--from", "github", "--full-access"],
    );
    expect(out).toContain(`scope: ${FULL_SIGN_IN}`);
    expect(output.stderr).toContain("note: github-2 has full access");
    expect(output.stderr).toContain(
      "couldn't read github-2 back after creating it (socket hang up)",
    );
  });
});

describe("dam connection connect github-app", () => {
  const appTemplate: ConnectionTemplateView = {
    id: "github-app",
    name: "GitHub App",
    category: "app",
    isCustom: false,
    authKind: "github-app",
    inputs: [
      { name: "appId", state: "required" },
      { name: "installationId", state: "required" },
      { name: "privateKey", state: "required", secret: true },
      { name: "repositories", state: "optional" },
      { name: "repositoryIds", state: "optional" },
      { name: "permissions", state: "optional" },
    ],
  };
  const inputs = [
    "github-app",
    "--app-id",
    "1",
    "--installation-id",
    "2",
    "--name",
    "my-app",
  ];

  const connect = (svc: Partial<ConnectionService>) =>
    buildConnectCommand(
      deps({
        list: async () => ok([]),
        listTemplates: async () => ok([appTemplate]),
        probeGitHubApp: async () => ok(appProbe),
        ...svc,
      }),
    );

  /** TEST_SCENARIO: the scope rides in the create input, and the server makes the installation and its first connection; the output names both. */
  it("creates the installation with its first connection", async () => {
    const create = vi.fn(async () => ok({ id: "conn-app" }));
    const out = await run(
      connect({ createConnection: create, getConnection: async () => ok(app) }),
      [...inputs, "--private-key", "k", "--repositories", "api"],
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ repositories: "api" }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.not.objectContaining({ fullAccess: true }),
    );
    expect(out).toContain(
      "✓ Created my-app (conn-app) from the GitHub App installation my-app (conn-inst)",
    );
    expect(out).toContain("scope: repos api; perms issues:write");
  });

  /** TEST_SCENARIO: --full-access is sent as `fullAccess: true` in the create input on the secret-entry page path too, so the page creates the connection the user chose. */
  it("passes --full-access to the secret-entry page", async () => {
    const requestSecret = vi.fn(async () =>
      ok({ requestId: "req-1", url: "https://dam/secret", expiresAt: "" }),
    );
    await run(
      connect({
        requestSecret,
        secretRequestStatus: async () =>
          ok({ status: "saved" as const, connectionId: "conn-app" }),
        getConnection: async () =>
          ok({ ...app, githubAppScope: undefined, fullAccess: true as const }),
      }),
      [...inputs, "--full-access", "--no-browser"],
    );
    expect(requestSecret).toHaveBeenCalledWith({
      action: "create",
      connection: expect.objectContaining({ fullAccess: true }),
    });
    expect(output.stdout).toContain(
      "scope: FULL ACCESS — the whole installation, every repository and permission",
    );
  });

  /** TEST_SCENARIO: without a scope or --full-access the server keeps the installation alone; the command says so, shows what it reaches and how to make a connection from it. */
  it("reports the installation alone", async () => {
    const out = await run(
      connect({
        createConnection: async () => ok({ id: "conn-inst" }),
        getConnection: async () => ok(installation),
      }),
      [...inputs, "--private-key", "k"],
    );
    expect(out).toContain(
      "✓ Created the GitHub App installation my-app (conn-inst)",
    );
    expect(out).toContain("It reaches:\nInstallation:");
    expect(output.stderr).toContain(
      "dam connection connect --from conn-inst --repositories <names>",
    );
  });

  /** TEST_SCENARIO: when the result can't be read back, the command still tells an installation kept alone from one made with its first connection, from the scope it sent, and says the read failed. */
  it("falls back to what was sent when it can't read the result", async () => {
    await run(
      connect({
        createConnection: async () => ok({ id: "conn-inst" }),
        getConnection: async () => readFailed,
      }),
      [...inputs, "--private-key", "k"],
    );
    expect(output.stdout).toContain(
      "✓ Created the GitHub App installation my-app (conn-inst)",
    );
    expect(output.stderr).toContain("No connection is made from it yet");
    expect(output.stderr).toContain("couldn't read my-app back");

    await run(
      connect({
        createConnection: async () => ok({ id: "conn-app" }),
        getConnection: async () => readFailed,
      }),
      [...inputs, "--private-key", "k", "--repositories", "api"],
    );
    expect(output.stdout).toContain(
      "✓ Created my-app (conn-app) from the GitHub App installation my-app\n" +
        "  scope: repos api; all perms\n",
    );
    expect(output.stderr).toContain("couldn't read my-app back");
  });
});

describe("commands on a sign-in and its connections", () => {
  const agents = {
    list: async () =>
      ok([{ id: "agent-00000000000000aa", name: "scout" } as AgentView]),
  };

  /** TEST_SCENARIO: a sign-in is never granted; the command refuses it and names the connections made from it, while the shared name grants the connection. */
  it("grants a connection, never its sign-in", async () => {
    const grant = vi.fn(async () => ok(["conn-gh"]));
    const svc = { list: async () => ok([signIn, fullChild, docsChild]), grant };
    await run(
      buildGrantCommand(deps(svc, agents)),
      ["scout", "--connection", "conn-signin"],
      EXIT_INVALID_INPUT,
    );
    expect(grant).not.toHaveBeenCalled();
    expect(output.stderr).toContain(
      "is a GitHub sign-in, which is never granted to an agent",
    );
    expect(output.stderr).toContain(
      "grant a connection made from it: github (conn-gh), github-docs (conn-docs)",
    );

    await run(buildGrantCommand(deps(svc, agents)), [
      "scout",
      "--connection",
      "github",
    ]);
    expect(grant).toHaveBeenCalledWith("agent-00000000000000aa", ["conn-gh"]);
  });

  /** TEST_SCENARIO: a connection's token comes from its sign-in, so re-authenticating the connection signs in again for the sign-in, which renews every connection made from it. */
  it("re-authenticates a connection's sign-in", async () => {
    const startOAuth = vi.fn(async () => ok({ authUrl: "https://github" }));
    const out = await run(
      buildReauthCommand(
        deps({
          list: async () => ok([signIn, fullChild]),
          startOAuth,
          getConnection: async () =>
            ok({ ...signIn, connectedAt: "2026-10-26T10:00:00Z" }),
        }),
      ),
      ["github", "--no-browser", "--json"],
    );
    expect(startOAuth).toHaveBeenCalledWith("conn-signin");
    expect(JSON.parse(out)).toEqual({
      ok: true,
      id: "conn-signin",
      name: "github",
    });
  });

  /** TEST_SCENARIO: the installation holds the private key of every connection made from it, so `update` and `reauth` of such a connection point at the installation's id. */
  it("points a connection's key at its installation", async () => {
    const update = vi.fn();
    const svc = { list: async () => ok([installation, app]), update };
    await run(
      buildUpdateCommand(deps(svc)),
      ["my-app", "--value", "k"],
      EXIT_INVALID_INPUT,
    );
    expect(update).not.toHaveBeenCalled();
    expect(output.stderr).toContain(
      "made from the GitHub App installation my-app (conn-inst)",
    );
    expect(output.stderr).toContain("dam connection update conn-inst");

    await run(buildReauthCommand(deps(svc)), ["my-app"], EXIT_INVALID_INPUT);
    expect(output.stderr).toContain("dam connection update conn-inst");
  });
});
