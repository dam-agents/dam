// TEST_OVERVIEW: on a server that offers several GitHub Enterprise hosts, `dam connection connect github-enterprise` signs in on the host --host names, asks which one at a terminal without it, and without a terminal fails with the offered hosts listed; a --host the server does not offer, or one it retired, fails the same way before anything is created or a browser opens. `dam connection templates` names the offered hosts, and `dam connection list` says when a connection's host is retired.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionTemplateView } from "api-server-api";

const fake = vi.hoisted(() => ({
  picked: "" as unknown,
  asked: [] as unknown[],
}));
vi.mock("@clack/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clack/prompts")>()),
  select: async (opts: unknown) => {
    fake.asked.push(opts);
    return fake.picked;
  },
}));

const { buildConnectCommand } =
  await import("../modules/connection/commands/connect.js");
const { buildListCommand } =
  await import("../modules/connection/commands/list.js");
const { buildTemplatesCommand } =
  await import("../modules/connection/commands/templates.js");
const { EXIT_INVALID_INPUT } = await import("../modules/shared/exit-codes.js");
const { captureOutput, deps, ok, output, run, signIn, view } =
  await import("./connection-commands.js");

captureOutput();

const HOSTS = ["research.ghe.example.com", "consulting.ghe.example.com"];

const GHE: ConnectionTemplateView = {
  id: "github-enterprise",
  name: "GitHub Enterprise",
  category: "app",
  isCustom: false,
  authKind: "oauth",
  inputs: [
    { name: "host", state: "required", presetValue: HOSTS[0] },
    { name: "clientId", state: "overridable" },
    { name: "clientSecret", state: "overridable", secret: true },
  ],
  extras: { hostChoices: HOSTS },
};

const isTTY = process.stdin.isTTY;
beforeEach(() => {
  fake.picked = "";
  fake.asked = [];
});
afterEach(() => {
  process.stdin.isTTY = isTTY;
});

function connect(create = vi.fn(async () => ok({ id: "conn-signin" }))) {
  const startOAuth = vi.fn(async () => ok({ authUrl: "https://ghe/login" }));
  const command = buildConnectCommand(
    deps({
      list: async () => ok([]),
      listTemplates: async () => ok([GHE]),
      createConnection: create,
      startOAuth,
      getConnection: async () => ok({ ...signIn, connectedAt: "now" }),
    }),
  );
  return { command, create, startOAuth };
}

describe("dam connection connect github-enterprise", () => {
  // TEST_SCENARIO: --host picks the user's Business Unit host, written in any case or as a URL, and the sign-in is made on that host.
  it("signs in on the offered host --host names", async () => {
    const { command, create } = connect();
    await run(command, [
      "github-enterprise",
      "--host",
      "https://Consulting.GHE.example.com",
      "--no-browser",
      "--timeout",
      "1",
      "--json",
    ]).catch(() => {});
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ host: "consulting.ghe.example.com" }),
    );
  });

  // TEST_SCENARIO: a host the server does not offer, or one it retired, would only fail at GitHub or leave a dead sign-in; the CLI refuses it with the offered hosts listed, before anything is created or a browser opens.
  it("refuses a host the server does not offer", async () => {
    const { command, create, startOAuth } = connect();
    await run(
      command,
      ["github-enterprise", "--host", "github.example.com"],
      EXIT_INVALID_INPUT,
    );
    expect(output.stderr).toMatch(
      /github\.example\.com is not a GitHub Enterprise host this server offers, or it is retired/,
    );
    expect(output.stderr).toContain(`offered hosts: ${HOSTS.join(", ")}`);
    expect(create).not.toHaveBeenCalled();
    expect(startOAuth).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: a user with their own GitHub app may sign in on a host the server does not offer, with its client ID and secret; with the ID alone it fails before anything is made, as the server would refuse it. The server still refuses a retired host.
  it("lets your own app sign in on another host", async () => {
    const { command, create } = connect();
    await run(
      command,
      [
        "github-enterprise",
        "--host",
        "ghe.own.example.com",
        "--client-id",
        "Iv1.mine",
      ],
      EXIT_INVALID_INPUT,
    );
    expect(output.stderr).toMatch(/needs --client-secret too/);
    expect(create).not.toHaveBeenCalled();

    await run(command, [
      "github-enterprise",
      "--host",
      "ghe.own.example.com",
      "--client-id",
      "Iv1.mine",
      "--client-secret",
      "mine-secret",
      "--no-browser",
      "--timeout",
      "1",
      "--json",
    ]).catch(() => {});
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "ghe.own.example.com",
        clientId: "Iv1.mine",
        clientSecret: "mine-secret",
      }),
    );
  });

  // TEST_SCENARIO: a script with no terminal must not get the first host silently; it fails and is told which hosts it may pass.
  it("asks for --host without a terminal", async () => {
    process.stdin.isTTY = false;
    const { command, create } = connect();
    await run(command, ["github-enterprise"], EXIT_INVALID_INPUT);
    expect(output.stderr).toMatch(
      /offers several GitHub Enterprise hosts; pass one with --host/,
    );
    expect(output.stderr).toContain(`offered hosts: ${HOSTS.join(", ")}`);
    expect(create).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: at a terminal the user picks the host from the offered list, and the sign-in is made on the one picked.
  it("asks which host at a terminal", async () => {
    process.stdin.isTTY = true;
    fake.picked = HOSTS[1];
    const { command, create } = connect();
    await run(command, [
      "github-enterprise",
      "--no-browser",
      "--timeout",
      "1",
      "--json",
    ]).catch(() => {});
    expect(fake.asked).toEqual([
      expect.objectContaining({
        options: HOSTS.map((h) => ({ value: h, label: h })),
      }),
    ]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ host: HOSTS[1] }),
    );
  });

  // TEST_SCENARIO: a server that offers one host has nothing to ask, but still refuses another; the CLI signs in on that host without --host and refuses any other before anything is made, as the server would.
  it("takes the one offered host and refuses any other", async () => {
    process.stdin.isTTY = false;
    const create = vi.fn(async () => ok({ id: "conn-signin" }));
    const command = buildConnectCommand(
      deps({
        list: async () => ok([]),
        listTemplates: async () =>
          ok([{ ...GHE, extras: { hostChoices: [HOSTS[0]] } }]),
        createConnection: create,
        startOAuth: async () => ok({ authUrl: "https://ghe/login" }),
        getConnection: async () => ok({ ...signIn, connectedAt: "now" }),
      }),
    );
    await run(
      command,
      ["github-enterprise", "--host", "ghe.other.example.com"],
      EXIT_INVALID_INPUT,
    );
    expect(output.stderr).toContain(`offered hosts: ${HOSTS[0]}`);
    expect(create).not.toHaveBeenCalled();

    await run(command, [
      "github-enterprise",
      "--no-browser",
      "--timeout",
      "1",
      "--json",
    ]).catch(() => {});
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ host: HOSTS[0] }),
    );
  });

  // TEST_SCENARIO: a server that sends no host list keeps the free host input it always had.
  it("leaves a server without a host list as it was", async () => {
    process.stdin.isTTY = false;
    const create = vi.fn(async () => ok({ id: "conn-signin" }));
    const command = buildConnectCommand(
      deps({
        list: async () => ok([]),
        listTemplates: async () => ok([{ ...GHE, extras: {} }]),
        createConnection: create,
        startOAuth: async () => ok({ authUrl: "https://ghe/login" }),
        getConnection: async () => ok({ ...signIn, connectedAt: "now" }),
      }),
    );
    await run(command, [
      "github-enterprise",
      "--host",
      "ghe.other.example.com",
      "--no-browser",
      "--timeout",
      "1",
      "--json",
    ]).catch(() => {});
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ host: "ghe.other.example.com" }),
    );
  });
});

describe("dam connection templates", () => {
  // TEST_SCENARIO: the user finds which hosts they may pass to --host from the template list, in the table and in --json.
  it("names the offered GitHub Enterprise hosts", async () => {
    const templates = () =>
      buildTemplatesCommand(deps({ listTemplates: async () => ok([GHE]) }));
    const out = await run(templates(), []);
    expect(
      out.split("\n").find((l) => l.startsWith("github-enterprise")),
    ).toContain(`hosts: ${HOSTS.join(", ")}`);
    const json = JSON.parse(await run(templates(), ["--json"]));
    expect(json[0].extras.hostChoices).toEqual(HOSTS);
  });
});

describe("dam connection list", () => {
  // TEST_SCENARIO: "disconnected" alone does not say why; a connection on a retired host names the host in its status, and --json carries retiredHost.
  it("says when a connection's host is retired", async () => {
    const retired = view({
      id: "conn-ghe",
      name: "ghe",
      templateId: "github-enterprise",
      status: "disconnected",
      retiredHost: "github.example.com",
      isParent: true,
    });
    const list = () =>
      buildListCommand(deps({ list: async () => ok([retired]) }));
    const out = await run(list(), []);
    expect(out.split("\n").find((l) => l.startsWith("conn-ghe"))).toContain(
      "disconnected (github.example.com retired)",
    );
    const json = JSON.parse(await run(list(), ["--json"]));
    expect(json[0]).toMatchObject({ retiredHost: "github.example.com" });
  });
});
