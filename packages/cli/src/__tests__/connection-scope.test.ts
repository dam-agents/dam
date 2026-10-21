// TEST_OVERVIEW: The CLI limits a GitHub connection to chosen repositories and permissions. `dam connection connect github` narrows the sign-in after consent when it gets --account, --repositories, --repository-ids or --permissions. `dam connection scope` shows the scope and what can be chosen, changes it for a GitHub sign-in (updateGitHubUserTokenScope) or a GitHub App connection (updateGitHubAppScope), keeps each part no flag names, and --clear removes the limit. `dam connection list` shows the scope in one shape for both kinds, with an explicit "unrestricted", in the table and in --json.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConnectionTemplateView,
  ConnectionView,
  GitHubUserTokenProbe,
} from "api-server-api";
import { buildConnectCommand } from "../modules/connection/commands/connect.js";
import { buildListCommand } from "../modules/connection/commands/list.js";
import { buildScopeCommand } from "../modules/connection/commands/scope.js";
import type { ConnectionService } from "../modules/connection/services/connection-service.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../modules/shared/exit-codes.js";

const view = (over: Partial<ConnectionView>): ConnectionView => ({
  id: "conn-x",
  ownerId: "user-1",
  templateId: "github",
  category: "app",
  name: "x",
  status: "active",
  authKind: "oauth",
  contributions: [],
  hosts: [],
  ...over,
});

const signIn = view({
  id: "conn-gh",
  name: "github",
  hosts: ["github.com"],
  githubUserToken: {},
});
const narrowedSignIn = view({
  id: "conn-gh",
  name: "github",
  hosts: ["github.com"],
  githubUserToken: {
    scope: {
      targetId: 11,
      targetLogin: "acme",
      repositoryIds: [101],
      permissions: { contents: "read" },
    },
  },
});
const app = view({
  id: "conn-app",
  name: "my-app",
  templateId: "github-app",
  authKind: "github-app",
  githubAppScope: {
    repositories: ["api"],
    permissions: { issues: "write" },
  },
});
const slack = view({ id: "conn-slack", name: "slack", templateId: "slack" });

const probe: GitHubUserTokenProbe = {
  installations: [
    {
      installationId: 1,
      targetId: 11,
      accountLogin: "acme",
      permissions: { contents: "write", pull_requests: "write" },
      repositorySelection: "selected",
      repositories: [
        { id: 101, name: "api" },
        { id: 102, name: "web" },
      ],
    },
    {
      installationId: 2,
      targetId: 22,
      accountLogin: "octo",
      permissions: { contents: "read" },
      repositorySelection: "all",
      repositories: [{ id: 201, name: "dotfiles" }],
    },
  ],
};

const deps = (svc: Partial<ConnectionService>) => ({
  compatService: {
    check: async () => ({
      ok: true as const,
      value: {
        kind: "ok" as const,
        localCli: "1.0.0",
        serverVersion: "1.0.0",
        serverMinClient: undefined,
        serverRecommendedClient: undefined,
      },
    }),
  },
  configService: {
    getResolved: async () => ({
      ok: true as const,
      value: { server: "http://localhost:4444" },
    }),
    set: vi.fn(),
  },
  createAgentService: () => {
    throw new Error("no agent lookup expected");
  },
  createConnectionService: () => svc as ConnectionService,
  browserOpener: {
    open: async () => ({ ok: true as const, value: undefined }),
  },
});

let stdout = "";
let stderr = "";

async function run(
  command: { parseAsync: (a: string[], o: { from: "user" }) => unknown },
  args: string[],
  code = EXIT_SUCCESS,
) {
  stdout = "";
  stderr = "";
  await expect(command.parseAsync(args, { from: "user" })).rejects.toThrow(
    `exit ${code}`,
  );
  return stdout;
}

beforeEach(() => {
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
  vi.spyOn(process.stdout, "write").mockImplementation(
    (chunk: unknown, done?: unknown) => {
      stdout += String(chunk);
      if (typeof done === "function") (done as () => void)();
      return true;
    },
  );
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(() => vi.restoreAllMocks());

const ok = <T>(value: T) => ({ ok: true as const, value });

describe("dam connection list", () => {
  const list = () =>
    buildListCommand(
      deps({ list: async () => ok([signIn, app, slack, narrowedSignIn]) }),
    );

  /** TEST_SCENARIO: a GitHub sign-in with no limit says "unrestricted", not nothing, so an agent can tell it apart from a connection that can't be limited ("—"). */
  it("shows a SCOPE column", async () => {
    const out = await run(
      buildListCommand(deps({ list: async () => ok([signIn, app, slack]) })),
      [],
    );
    const lines = out.split("\n");
    expect(lines[0]).toMatch(/SCOPE/);
    expect(lines.find((l) => l.startsWith("conn-gh"))).toMatch(/unrestricted$/);
    expect(lines.find((l) => l.startsWith("conn-app"))).toMatch(
      /repos api; perms issues:write$/,
    );
    expect(lines.find((l) => l.startsWith("conn-slack"))).toMatch(/—$/);
  });

  /** TEST_SCENARIO: --json carries one `scope` shape for a sign-in and an App connection, and none on a connection that can't be limited. */
  it("adds scope to --json", async () => {
    const out = await run(list(), ["--json"]);
    const rows = JSON.parse(out) as (ConnectionView & { scope?: unknown })[];
    expect(rows[0]!.scope).toEqual({ restricted: false });
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
  });
});

describe("dam connection scope", () => {
  const scope = (svc: Partial<ConnectionService>) =>
    buildScopeCommand(deps(svc));

  /** TEST_SCENARIO: without flags the command changes nothing and lists the accounts, repositories and permissions the agent can choose from. */
  it("shows the scope and what can be chosen", async () => {
    const update = vi.fn();
    const out = await run(
      scope({
        list: async () => ok([signIn]),
        probeGitHubUserToken: async () => ok(probe),
        updateGitHubUserTokenScope: update,
      }),
      ["github"],
    );
    expect(update).not.toHaveBeenCalled();
    expect(out).toContain("github (conn-gh): unrestricted");
    expect(out).toContain("Account acme:");
    expect(out).toContain("api (101), web (102)");
    expect(out).toContain("contents:write, pull_requests:write");
  });

  /** TEST_SCENARIO: repository names are resolved to the ids GitHub's scoped-token endpoint takes, on the account named. */
  it("narrows a sign-in to an account, repositories and permissions", async () => {
    const update = vi.fn(async () => ok(undefined));
    await run(
      scope({
        list: async () => ok([signIn]),
        probeGitHubUserToken: async () => ok(probe),
        updateGitHubUserTokenScope: update,
        getConnection: async () => ok(narrowedSignIn),
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
    expect(stdout).toContain("✓ Scoped github (conn-gh): account acme");
  });

  /** TEST_SCENARIO: a flag left out keeps that part of the current scope, so changing the permissions does not widen the repositories. */
  it("keeps what no flag names", async () => {
    const update = vi.fn(async () => ok(undefined));
    await run(
      scope({
        list: async () => ok([narrowedSignIn]),
        probeGitHubUserToken: async () => ok(probe),
        updateGitHubUserTokenScope: update,
        getConnection: async () => ok(narrowedSignIn),
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
        list: async () => ok([signIn]),
        probeGitHubUserToken: async () => ok(probe),
      }),
      ["github", "--repositories", "api"],
      EXIT_INVALID_INPUT,
    );
    expect(stderr).toContain("pass --account");
    expect(stderr).toContain("acme, octo");
  });

  /** TEST_SCENARIO: a repository the installation doesn't list is refused before anything is changed. */
  it("refuses a repository the account doesn't have", async () => {
    const update = vi.fn();
    await run(
      scope({
        list: async () => ok([signIn]),
        probeGitHubUserToken: async () => ok(probe),
        updateGitHubUserTokenScope: update,
      }),
      ["github", "--account", "acme", "--repositories", "nope"],
      EXIT_INVALID_INPUT,
    );
    expect(update).not.toHaveBeenCalled();
    expect(stderr).toContain("no repository 'nope'");
  });

  /** TEST_SCENARIO: --clear sends no scope, which the server reads as "not narrowed", for a sign-in and for an App connection alike. */
  it("clears the scope", async () => {
    const userUpdate = vi.fn(async () => ok(undefined));
    await run(
      scope({
        list: async () => ok([narrowedSignIn]),
        updateGitHubUserTokenScope: userUpdate,
        getConnection: async () => ok(signIn),
      }),
      ["github", "--clear"],
    );
    expect(userUpdate).toHaveBeenCalledWith({ id: "conn-gh" });
    expect(stdout).toContain("unrestricted");

    const appUpdate = vi.fn(async () => ok(undefined));
    await run(
      scope({
        list: async () => ok([app]),
        updateGitHubAppScope: appUpdate,
        getConnection: async () => ok({ ...app, githubAppScope: undefined }),
      }),
      ["my-app", "--clear"],
    );
    expect(appUpdate).toHaveBeenCalledWith({ id: "conn-app" });
  });

  /** TEST_SCENARIO: a GitHub App connection's scope, fixed at creation before, changes through updateGitHubAppScope and keeps the repositories when only permissions change. */
  it("changes a GitHub App connection's scope", async () => {
    const update = vi.fn(async () => ok(undefined));
    await run(
      scope({
        list: async () => ok([app]),
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

  /** TEST_SCENARIO: only GitHub sign-ins and GitHub App connections can be limited; any other is refused. */
  it("refuses a connection that can't be limited", async () => {
    await run(
      scope({ list: async () => ok([slack]) }),
      ["slack", "--repositories", "api"],
      EXIT_INVALID_INPUT,
    );
    expect(stderr).toContain("only those can be limited");
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
        listTemplates: async () => ok([githubTemplate]),
        createConnection: async () => ok({ id: "conn-gh" }),
        startOAuth: async () => ok({ authUrl: "https://github.com/login" }),
        probeGitHubUserToken: async () => ok(probe),
        ...svc,
      }),
    );

  /** TEST_SCENARIO: the scope flags, which used to apply to GitHub App installations alone, narrow a new GitHub sign-in right after consent, before any agent is granted it. */
  it("narrows the sign-in after consent", async () => {
    const update = vi.fn(async () => ok(undefined));
    const getConnection = vi
      .fn()
      .mockResolvedValueOnce(ok(signIn))
      .mockResolvedValue(ok(narrowedSignIn));
    const out = await run(
      connect({ updateGitHubUserTokenScope: update, getConnection }),
      [
        "github",
        "--account",
        "acme",
        "--repositories",
        "api",
        "--no-browser",
        "--json",
      ],
    );
    expect(update).toHaveBeenCalledWith({
      id: "conn-gh",
      targetId: 11,
      repositoryIds: "101",
    });
    expect(JSON.parse(out)).toMatchObject({
      ok: true,
      id: "conn-gh",
      scope: { restricted: true, account: "acme", repositoryIds: [101] },
    });
  });

  /** TEST_SCENARIO: when the narrowing fails, the connection exists unrestricted; the CLI fails and says how to limit or remove it, so it is not granted by mistake. */
  it("fails loudly when it can't narrow", async () => {
    const update = vi.fn();
    await run(
      connect({
        updateGitHubUserTokenScope: update,
        getConnection: async () => ok(signIn),
      }),
      ["github", "--repositories", "api", "--no-browser"],
      EXIT_RUNTIME_FAILURE,
    );
    expect(update).not.toHaveBeenCalled();
    expect(stderr).toContain("couldn't limit it: pass --account");
    expect(stderr).toContain("dam connection scope github");
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
