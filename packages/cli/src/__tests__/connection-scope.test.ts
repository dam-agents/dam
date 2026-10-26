// TEST_OVERVIEW: The CLI limits a GitHub connection to chosen repositories and permissions. A GitHub sign-in or GitHub App installation holds the credential and is never granted; agents get the connections made from it, each with its own scope or an explicit full access. `dam connection connect github` makes the first connection from the new sign-in after consent when it gets --account, --repositories, --repository-ids or --permissions, or --full-access, and keeps the sign-in alone otherwise. `dam connection scope` shows the scope and what can be chosen, changes it for a connection made from a sign-in (updateGitHubUserTokenScope) or from an App installation (updateGitHubAppScope), keeps each part no flag names, and gives full access only on --full-access. `dam connection list` shows each sign-in with its connections underneath, marks FULL ACCESS, and gives the scope in one shape for both kinds in --json.
import { describe, expect, it, vi } from "vitest";
import type { ConnectionTemplateView, ConnectionView } from "api-server-api";
import { buildConnectCommand } from "../modules/connection/commands/connect.js";
import { buildListCommand } from "../modules/connection/commands/list.js";
import { buildScopeCommand } from "../modules/connection/commands/scope.js";
import type { ConnectionService } from "../modules/connection/services/connection-service.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
} from "../modules/shared/exit-codes.js";
import {
  app,
  captureOutput,
  deps,
  docsChild,
  FULL_SIGN_IN,
  fullChild,
  installation,
  narrowedChild,
  ok,
  output,
  probe,
  run,
  signIn,
  slack,
} from "./connection-commands.js";

captureOutput();

describe("dam connection list", () => {
  const all = [fullChild, slack, app, signIn, docsChild, installation];

  /** TEST_SCENARIO: each GitHub sign-in and GitHub App installation is listed with the connections made from it underneath, so the user sees which connections share one credential and that the sign-in itself is not what an agent gets. */
  it("shows each sign-in with its connections underneath", async () => {
    const out = await run(
      buildListCommand(deps({ list: async () => ok(all) })),
      [],
    );
    const lines = out.split("\n");
    expect(lines[0]).toMatch(/SCOPE/);
    const at = (id: string) => lines.findIndex((l) => l.startsWith(id));
    expect(lines[at("conn-signin")]).toMatch(
      /conn-signin\s+github\s.*GitHub sign-in \(never granted itself\)$/,
    );
    expect(at("conn-gh")).toBe(at("conn-signin") + 1);
    expect(lines[at("conn-gh")]).toMatch(/conn-gh\s+├─ github\s/);
    expect(at("conn-docs")).toBe(at("conn-signin") + 2);
    expect(lines[at("conn-docs")]).toMatch(
      /└─ github-docs\s.*account acme; repos web; all perms$/,
    );
    expect(at("conn-app")).toBe(at("conn-inst") + 1);
    expect(lines[at("conn-app")]).toMatch(
      /└─ my-app\s.*repos api; perms issues:write$/,
    );
    expect(lines[at("conn-slack")]).toMatch(/—$/);
  });

  /** TEST_SCENARIO: a connection with full access says so in capitals with what it reaches, so it can't be mistaken for a limited one. */
  it("marks full access", async () => {
    const out = await run(
      buildListCommand(deps({ list: async () => ok(all) })),
      [],
    );
    const row = out.split("\n").find((l) => l.startsWith("conn-gh"));
    expect(row).toMatch(new RegExp(`${FULL_SIGN_IN}$`));
  });

  /** TEST_SCENARIO: a sign-in nothing is made from yet says so, and a connection whose sign-in is not in the list, as in an agent's list, prints as an ordinary row. */
  it("shows a sign-in alone and a connection without its sign-in", async () => {
    const out = await run(
      buildListCommand(
        deps({ list: async () => ok([{ ...signIn, id: "conn-bare" }, app]) }),
      ),
      [],
    );
    const lines = out.split("\n");
    expect(lines.find((l) => l.startsWith("conn-bare"))).toMatch(
      /GitHub sign-in \(no connection made from it yet\)$/,
    );
    expect(lines.find((l) => l.startsWith("conn-app"))).toMatch(
      /^conn-app\s+my-app\s/,
    );
  });

  /** TEST_SCENARIO: --json carries one `scope` shape for a connection made from a sign-in and one made from an App installation, with an explicit `fullAccess: true`; a sign-in or installation carries `isParent` and no scope, and a connection that can't be limited none. */
  it("adds scope to --json", async () => {
    const out = await run(
      buildListCommand(
        deps({
          list: async () =>
            ok([fullChild, app, slack, narrowedChild, signIn, docsChild]),
        }),
      ),
      ["--json"],
    );
    const rows = JSON.parse(out) as (ConnectionView & { scope?: unknown })[];
    expect(rows[0]!.scope).toEqual({ restricted: false, fullAccess: true });
    expect(rows[1]!.scope).toEqual({
      restricted: true,
      repositories: ["api"],
      permissions: { issues: "write" },
    });
    expect(rows[2]!.scope).toBeUndefined();
    expect(rows[3]!.scope).toEqual({
      restricted: true,
      account: "acme",
      accountId: 11,
      repositoryIds: [101],
      permissions: { contents: "read" },
    });
    expect(rows[3]!.parentId).toBe("conn-signin");
    expect(rows[4]!.scope).toBeUndefined();
    expect(rows[4]!.isParent).toBe(true);
    expect(rows[5]!.scope).toEqual({
      restricted: true,
      account: "acme",
      accountId: 11,
      repositories: ["web"],
      repositoryIds: [102],
    });
  });
});

describe("dam connection scope", () => {
  const scope = (svc: Partial<ConnectionService>) =>
    buildScopeCommand(deps(svc));

  /** TEST_SCENARIO: without flags the command changes nothing and lists the accounts, repositories and permissions the agent can choose from. The name the sign-in and its first connection share means the connection. */
  it("shows the scope and what can be chosen", async () => {
    const update = vi.fn();
    const out = await run(
      scope({
        list: async () => ok([signIn, fullChild]),
        probeGitHubUserToken: async () => ok(probe),
        updateGitHubUserTokenScope: update,
      }),
      ["github"],
    );
    expect(update).not.toHaveBeenCalled();
    expect(out).toContain(`github (conn-gh): ${FULL_SIGN_IN}`);
    expect(out).toContain("Made from the GitHub sign-in github (conn-signin).");
    expect(out).toContain("Account acme:");
    expect(out).toContain("api (101), web (102)");
    expect(out).toContain("contents:write, pull_requests:write");
  });

  /** TEST_SCENARIO: repository names are resolved to the ids GitHub's scoped-token endpoint takes, on the account named. */
  it("narrows a connection to an account, repositories and permissions", async () => {
    const update = vi.fn(async () => ok(undefined));
    await run(
      scope({
        list: async () => ok([signIn, fullChild]),
        probeGitHubUserToken: async () => ok(probe),
        updateGitHubUserTokenScope: update,
        getConnection: async () => ok(narrowedChild),
      }),
      [
        "github",
        "--account",
        "acme",
        "--repositories",
        "acme/web,api",
        "--permissions",
        "contents:read",
      ],
    );
    expect(update).toHaveBeenCalledWith({
      id: "conn-gh",
      targetId: 11,
      repositoryIds: "102 101",
      permissions: "contents:read",
    });
    expect(output.stdout).toContain("✓ Scoped github (conn-gh): account acme");
  });

  /** TEST_SCENARIO: a flag left out keeps that part of the current scope, so changing the permissions does not widen the repositories. */
  it("keeps what no flag names", async () => {
    const update = vi.fn(async () => ok(undefined));
    await run(
      scope({
        list: async () => ok([narrowedChild]),
        probeGitHubUserToken: async () => ok(probe),
        updateGitHubUserTokenScope: update,
        getConnection: async () => ok(narrowedChild),
      }),
      ["github", "--permissions", "contents:write"],
    );
    expect(update).toHaveBeenCalledWith({
      id: "conn-gh",
      targetId: 11,
      repositoryIds: "101",
      permissions: "contents:write",
    });
  });

  /** TEST_SCENARIO: with the app on more than one account, the command can't guess which one the token should reach. */
  it("asks for --account when the sign-in reaches several", async () => {
    await run(
      scope({
        list: async () => ok([fullChild]),
        probeGitHubUserToken: async () => ok(probe),
      }),
      ["github", "--repositories", "api"],
      EXIT_INVALID_INPUT,
    );
    expect(output.stderr).toContain("pass --account");
    expect(output.stderr).toContain("acme, octo");
  });

  /** TEST_SCENARIO: a repository the installation doesn't list is refused before anything is changed. */
  it("refuses a repository the account doesn't have", async () => {
    const update = vi.fn();
    await run(
      scope({
        list: async () => ok([fullChild]),
        probeGitHubUserToken: async () => ok(probe),
        updateGitHubUserTokenScope: update,
      }),
      ["github", "--account", "acme", "--repositories", "nope"],
      EXIT_INVALID_INPUT,
    );
    expect(update).not.toHaveBeenCalled();
    expect(output.stderr).toContain("no repository 'nope'");
  });

  /** TEST_SCENARIO: full access is an explicit `fullAccess: true`, never a scope left empty, for a connection made from a sign-in and one made from an App installation alike, and the result says what it reaches. */
  it("gives full access only with --full-access", async () => {
    const userUpdate = vi.fn(async () => ok(undefined));
    await run(
      scope({
        list: async () => ok([narrowedChild]),
        updateGitHubUserTokenScope: userUpdate,
        getConnection: async () => ok(fullChild),
      }),
      ["github", "--full-access"],
    );
    expect(userUpdate).toHaveBeenCalledWith({
      id: "conn-gh",
      fullAccess: true,
    });
    expect(output.stdout).toContain(
      `✓ Scoped github (conn-gh): ${FULL_SIGN_IN}`,
    );
    expect(output.stderr).toContain("note: github has full access");

    const appUpdate = vi.fn(async () => ok(undefined));
    await run(
      scope({
        list: async () => ok([app]),
        updateGitHubAppScope: appUpdate,
        getConnection: async () =>
          ok({ ...app, githubAppScope: undefined, fullAccess: true as const }),
      }),
      ["my-app", "--full-access", "--json"],
    );
    expect(appUpdate).toHaveBeenCalledWith({
      id: "conn-app",
      fullAccess: true,
    });
    expect(JSON.parse(output.stdout)).toMatchObject({
      scope: { restricted: false, fullAccess: true },
    });
  });

  /** TEST_SCENARIO: when the changed connection can't be read back, the output shows the scope that was sent, full access and its note included, and says the read failed. */
  it("shows what was sent when the change can't be read back", async () => {
    const readFailed = {
      ok: false as const,
      error: { kind: "transport" as const, reason: "socket hang up" },
    };
    await run(
      scope({
        list: async () => ok([narrowedChild]),
        updateGitHubUserTokenScope: async () => ok(undefined),
        getConnection: async () => readFailed,
      }),
      ["github", "--full-access"],
    );
    expect(output.stdout).toContain(
      `✓ Scoped github (conn-gh): ${FULL_SIGN_IN}`,
    );
    expect(output.stderr).toContain("note: github has full access");
    expect(output.stderr).toContain(
      "couldn't read github back after changing it (socket hang up)",
    );

    const json = await run(
      scope({
        list: async () => ok([app]),
        updateGitHubAppScope: async () => ok(undefined),
        getConnection: async () => readFailed,
      }),
      ["my-app", "--permissions", "contents:read", "--json"],
    );
    expect(JSON.parse(json)).toMatchObject({
      scope: {
        restricted: true,
        repositories: ["api"],
        permissions: { contents: "read" },
      },
    });
  });

  /** TEST_SCENARIO: --clear used to widen a connection to everything; an agent that still passes it is told to choose --full-access, and nothing changes. */
  it("refuses --clear and points at --full-access", async () => {
    const update = vi.fn();
    await run(
      scope({
        list: async () => ok([narrowedChild]),
        updateGitHubUserTokenScope: update,
      }),
      ["github", "--clear"],
      EXIT_INVALID_INPUT,
    );
    expect(update).not.toHaveBeenCalled();
    expect(output.stderr).toContain("pass --full-access");
  });

  /** TEST_SCENARIO: full access and a limit contradict each other, so the command refuses both together before it reads anything. */
  it("refuses --full-access with a scope flag", async () => {
    const list = vi.fn();
    await run(
      scope({ list }),
      ["github", "--full-access", "--repositories", "api"],
      EXIT_INVALID_INPUT,
    );
    expect(list).not.toHaveBeenCalled();
    expect(output.stderr).toContain("--full-access can't be combined");
  });

  /** TEST_SCENARIO: an empty flag lifts only its own limit. On a connection made from an App installation and limited by repositories alone, emptying them would leave no limit, which the server refuses; the CLI refuses first and points at --full-access. */
  it("refuses an edit that leaves no limit", async () => {
    const update = vi.fn();
    const reposOnly = { ...app, githubAppScope: { repositories: ["api"] } };
    await run(
      scope({
        list: async () => ok([reposOnly]),
        updateGitHubAppScope: update,
      }),
      ["my-app", "--repositories", ""],
      EXIT_INVALID_INPUT,
    );
    expect(update).not.toHaveBeenCalled();
    expect(output.stderr).toContain("without any limit");
    expect(output.stderr).toContain("--full-access");
  });

  /** TEST_SCENARIO: a GitHub App connection's scope changes through updateGitHubAppScope and keeps the repositories when only permissions change. */
  it("changes a GitHub App connection's scope", async () => {
    const update = vi.fn(async () => ok(undefined));
    await run(
      scope({
        list: async () => ok([installation, app]),
        updateGitHubAppScope: update,
        getConnection: async () => ok(app),
      }),
      ["my-app", "--permissions", "contents:read"],
    );
    expect(update).toHaveBeenCalledWith({
      id: "conn-app",
      repositories: "api",
      permissions: "contents:read",
    });
  });

  /** TEST_SCENARIO: a GitHub App is checked again with a token minted for the new scope, and the command reports that check, so an agent sees a scope the installation cannot satisfy without running `dam connection test`. */
  it("reports the check of a GitHub App's new scope", async () => {
    const check = {
      status: "passed" as const,
      account: "dam-bot[bot]",
      installedOn: "acme",
      repositories: ["api"],
      at: "2026-10-24T08:00:00.000Z",
    };
    const after = { ...app, check };
    const deps = scope({
      list: async () => ok([app]),
      updateGitHubAppScope: async () => ok(undefined),
      getConnection: async () => ok(after),
    });
    const out = await run(deps, ["my-app", "--repositories", "api"]);
    expect(out).toContain(
      "check: passed (as dam-bot[bot]; installed on acme; repositories api)",
    );

    const json = await run(
      scope({
        list: async () => ok([app]),
        updateGitHubAppScope: async () => ok(undefined),
        getConnection: async () => ok(after),
      }),
      ["my-app", "--repositories", "api", "--json"],
    );
    expect(JSON.parse(json)).toMatchObject({ kind: "github-app", check });
  });

  /** TEST_SCENARIO: only GitHub sign-ins and GitHub App connections can be limited; any other is refused. */
  it("refuses a connection that can't be limited", async () => {
    await run(
      scope({ list: async () => ok([slack]) }),
      ["slack", "--repositories", "api"],
      EXIT_INVALID_INPUT,
    );
    expect(output.stderr).toContain("only those can be limited");
  });

  /** TEST_SCENARIO: a sign-in, named by its id, shows the connections made from it with their scopes and what it reaches, and how to make another. */
  it("shows a sign-in with the connections made from it", async () => {
    const out = await run(
      scope({
        list: async () => ok([signIn, fullChild, docsChild]),
        probeGitHubUserToken: async () => ok(probe),
      }),
      ["conn-signin"],
    );
    expect(out).toContain(
      "github (conn-signin): GitHub sign-in, never granted itself",
    );
    expect(out).toContain(`  github (conn-gh): ${FULL_SIGN_IN}`);
    expect(out).toContain(
      "  github-docs (conn-docs): account acme; repos web; all perms",
    );
    expect(out).toContain("It reaches:\nAccount acme:");
    expect(output.stderr).toContain(
      "dam connection connect --from conn-signin",
    );
  });

  /** TEST_SCENARIO: a sign-in is never granted, so it has no scope to change; the command names its connections and how to make another instead. */
  it("refuses to limit a sign-in", async () => {
    const update = vi.fn();
    await run(
      scope({
        list: async () => ok([signIn, fullChild, docsChild]),
        updateGitHubUserTokenScope: update,
      }),
      ["conn-signin", "--repositories", "api"],
      EXIT_INVALID_INPUT,
    );
    expect(update).not.toHaveBeenCalled();
    expect(output.stderr).toContain(
      "Connections made from it: github (conn-gh), github-docs (conn-docs)",
    );
    expect(output.stderr).toContain(
      "dam connection connect --from conn-signin",
    );
  });
});

describe("dam connection connect github", () => {
  const githubTemplate: ConnectionTemplateView = {
    id: "github",
    name: "GitHub",
    category: "app",
    isCustom: false,
    authKind: "oauth",
    inputs: [],
  };

  const connect = (svc: Partial<ConnectionService>) =>
    buildConnectCommand(
      deps({
        list: async () => ok([]),
        listTemplates: async () => ok([githubTemplate]),
        createConnection: async () => ok({ id: "conn-signin" }),
        startOAuth: async () => ok({ authUrl: "https://github.com/login" }),
        probeGitHubUserToken: async () => ok(probe),
        getConnection: async (id: string) =>
          ok(id === "conn-signin" ? signIn : narrowedChild),
        ...svc,
      }),
    );

  /** TEST_SCENARIO: the scope flags make the first connection from the new sign-in right after consent, so the user never holds a grantable connection that reaches more than they chose. */
  it("makes the first connection from the sign-in with the scope", async () => {
    const make = vi.fn(async () => ok({ id: "conn-gh" }));
    const out = await run(connect({ createFromParent: make }), [
      "github",
      "--account",
      "acme",
      "--repositories",
      "api",
      "--no-browser",
      "--json",
    ]);
    expect(make).toHaveBeenCalledWith({
      parentId: "conn-signin",
      name: "github",
      targetId: 11,
      repositoryIds: "101",
    });
    expect(JSON.parse(out)).toMatchObject({
      ok: true,
      id: "conn-gh",
      name: "github",
      parentId: "conn-signin",
      scope: { restricted: true, account: "acme", repositoryIds: [101] },
    });
  });

  /** TEST_SCENARIO: full access is made only on --full-access, as an explicit `fullAccess: true`, and the output says so in capitals. */
  it("makes a full-access connection only with --full-access", async () => {
    const make = vi.fn(async () => ok({ id: "conn-gh" }));
    const probeFn = vi.fn();
    const out = await run(
      connect({
        createFromParent: make,
        probeGitHubUserToken: probeFn,
        getConnection: async (id: string) =>
          ok(id === "conn-signin" ? signIn : fullChild),
      }),
      ["github", "--full-access", "--no-browser"],
    );
    expect(make).toHaveBeenCalledWith({
      parentId: "conn-signin",
      name: "github",
      fullAccess: true,
    });
    expect(probeFn).not.toHaveBeenCalled();
    expect(out).toContain(
      "✓ Connected github (conn-gh) from the GitHub sign-in github (conn-signin)",
    );
    expect(out).toContain(`scope: ${FULL_SIGN_IN}`);
    expect(output.stderr).toContain("note: github has full access");
  });

  /** TEST_SCENARIO: with neither a scope nor --full-access, the command keeps the sign-in alone, which no agent can be granted, shows what it reaches and how to make a connection from it, and succeeds. */
  it("keeps the sign-in alone without a scope or --full-access", async () => {
    const make = vi.fn();
    const out = await run(connect({ createFromParent: make }), [
      "github",
      "--no-browser",
    ]);
    expect(make).not.toHaveBeenCalled();
    expect(out).toContain(
      "✓ Connected the GitHub sign-in github (conn-signin)",
    );
    expect(out).toContain("It reaches:\nAccount acme:");
    expect(output.stderr).toContain("No connection is made from it yet");
    expect(output.stderr).toContain(
      "dam connection connect --from conn-signin --account <login>",
    );
    expect(output.stderr).toContain(
      "dam connection connect --from conn-signin --full-access",
    );

    const json = await run(connect({ createFromParent: make }), [
      "github",
      "--no-browser",
      "--json",
    ]);
    expect(JSON.parse(json)).toMatchObject({
      ok: true,
      id: "conn-signin",
      isParent: true,
      available: probe,
    });
  });

  /** TEST_SCENARIO: full access and a limit contradict each other, so the command refuses both together before it creates anything. */
  it("refuses --full-access with a scope flag", async () => {
    const create = vi.fn();
    await run(
      connect({ createConnection: create }),
      ["github", "--full-access", "--account", "acme"],
      EXIT_INVALID_INPUT,
    );
    expect(create).not.toHaveBeenCalled();
    expect(output.stderr).toContain("--full-access can't be combined");
  });

  /** TEST_SCENARIO: when the connection can't be made after sign-in, only the sign-in exists, which no agent can be granted; the CLI fails and says how to make the connection or remove the sign-in. */
  it("fails loudly when it can't make the connection", async () => {
    const make = vi.fn();
    await run(
      connect({ createFromParent: make }),
      ["github", "--repositories", "api", "--no-browser"],
      EXIT_RUNTIME_FAILURE,
    );
    expect(make).not.toHaveBeenCalled();
    expect(output.stderr).toContain(
      "couldn't make a connection from the GitHub sign-in github (conn-signin): pass --account",
    );
    expect(output.stderr).toContain(
      "dam connection connect --from conn-signin",
    );
    expect(output.stderr).toContain("dam connection disconnect conn-signin");
  });

  /** TEST_SCENARIO: a second sign-in made without --name takes the next free name, so its first connection doesn't collide with one the user has. */
  it("takes the next free name", async () => {
    const create = vi.fn(async () => ok({ id: "conn-signin" }));
    const make = vi.fn(async () => ok({ id: "conn-gh" }));
    await run(
      connect({
        list: async () => ok([signIn, fullChild]),
        createConnection: create,
        createFromParent: make,
      }),
      ["github", "--full-access", "--no-browser", "--json"],
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "github-2" }),
    );
    expect(make).toHaveBeenCalledWith(
      expect.objectContaining({ name: "github-2" }),
    );
  });

  /** TEST_SCENARIO: --account means nothing for a template that isn't a GitHub sign-in, so it is refused before a connection is created. */
  it("refuses --account on another template", async () => {
    const create = vi.fn();
    await run(
      buildConnectCommand(
        deps({
          listTemplates: async () =>
            ok([{ ...githubTemplate, id: "github-pat", authKind: "header" }]),
          createConnection: create,
        }),
      ),
      ["github-pat", "--account", "acme", "--value", "x"],
      EXIT_INVALID_INPUT,
    );
    expect(create).not.toHaveBeenCalled();
  });
});
