// TEST_OVERVIEW: The CLI shows and changes the tool mode of an MCP connection, such as a Slack Account: allow all, read only or needs approval. `dam connection list` shows the mode in the SCOPE column and carries toolAccess in --json. `dam connection scope --mode` sets the mode with setToolMode and refuses the GitHub scope flags and a mode the connection does not offer. `dam connection tools` prints the tool list grouped into read and write tools, and reads it again on --refresh.
import type { ConnectionToolAccess } from "api-server-api";
import type { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { buildConnectCommand } from "../modules/connection/commands/connect.js";
import { buildListCommand } from "../modules/connection/commands/list.js";
import { buildScopeCommand } from "../modules/connection/commands/scope.js";
import { buildToolsCommand } from "../modules/connection/commands/tools.js";
import type { ConnectionService } from "../modules/connection/services/connection-service.js";
import { EXIT_INVALID_INPUT } from "../modules/shared/exit-codes.js";
import {
  app,
  captureOutput,
  deps,
  ok,
  output,
  run,
  view,
} from "./connection-commands.js";

captureOutput();

const ALL_MODES = ["allow-all", "read-only", "needs-approval"] as const;

const toolAccess = (
  over: Partial<ConnectionToolAccess> = {},
): ConnectionToolAccess => ({
  mode: "read-only",
  modes: ALL_MODES,
  defaultMode: "read-only",
  tools: null,
  listedAt: null,
  listError: null,
  ...over,
});

const readOnlySlack = view({
  id: "conn-slack",
  name: "slack",
  templateId: "slack",
  toolAccess: toolAccess(),
});
const postingSlack = view({
  id: "conn-slack-post",
  name: "slack-post",
  templateId: "slack",
  toolAccess: toolAccess({ mode: "allow-all" }),
});
const openMcp = view({
  id: "conn-open",
  name: "open-mcp",
  templateId: "custom-mcp-none",
  category: "mcp",
  toolAccess: toolAccess({
    mode: "allow-all",
    modes: ["allow-all"],
    defaultMode: "allow-all",
  }),
});

describe("an MCP connection in dam connection list", () => {
  const list = () =>
    buildListCommand(
      deps({ list: async () => ok([readOnlySlack, postingSlack]) }),
    );

  /** TEST_SCENARIO: the owner must see at a glance which Slack Account can post as them, so the SCOPE column names each connection's mode. */
  it("shows the mode in the SCOPE column", async () => {
    const lines = (await run(list(), [])).split("\n");
    expect(lines.find((l) => l.startsWith("conn-slack "))).toMatch(
      /read only$/,
    );
    expect(lines.find((l) => l.startsWith("conn-slack-post"))).toMatch(
      /allow all$/,
    );
  });

  /** TEST_SCENARIO: a script reads the mode from --json, in the toolAccess the server sends, with no GitHub scope added. */
  it("carries toolAccess in --json", async () => {
    const rows = JSON.parse(await run(list(), ["--json"]));
    expect(
      rows.map((r: { toolAccess: ConnectionToolAccess }) => r.toolAccess.mode),
    ).toEqual(["read-only", "allow-all"]);
    expect(rows[0]).not.toHaveProperty("scope");
  });
});

describe("dam connection scope on an MCP connection", () => {
  const scope = (svc: Partial<ConnectionService>) =>
    buildScopeCommand(deps(svc));

  /** TEST_SCENARIO: without a flag the command changes nothing and says which mode the connection is in and how to change it. */
  it("shows the mode and changes nothing", async () => {
    const setToolMode = vi.fn();
    const out = await run(
      scope({ list: async () => ok([readOnlySlack]), setToolMode }),
      ["slack"],
    );
    expect(out).toBe("slack (conn-slack): read only\n");
    expect(output.stderr).toContain(
      "dam connection scope slack --mode <allow-all|read-only|needs-approval>",
    );
    expect(setToolMode).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: the owner sets needs approval with --mode, and --json reports the new mode in toolAccess. */
  it("sets the mode with --mode", async () => {
    const setToolMode = vi.fn(async () => ok(undefined));
    const out = await run(
      scope({ list: async () => ok([postingSlack]), setToolMode }),
      ["slack-post", "--mode", "needs-approval", "--json"],
    );
    expect(setToolMode).toHaveBeenCalledWith({
      id: "conn-slack-post",
      mode: "needs-approval",
    });
    expect(JSON.parse(out)).toEqual({
      ok: true,
      id: "conn-slack-post",
      name: "slack-post",
      kind: "tool-mode",
      toolAccess: toolAccess({ mode: "needs-approval" }),
    });
  });

  /** TEST_SCENARIO: an MCP connection has no repositories or permissions, and an unknown mode or one the connection does not offer means nothing, so each is refused before the server is asked. */
  it("refuses scope flags, unknown modes and modes not offered", async () => {
    const setToolMode = vi.fn();
    const cases: [string[], string][] = [
      [["slack", "--repositories", "api"], "it has a tool mode, not a scope"],
      [["slack", "--full-access"], "it has a tool mode, not a scope"],
      [
        ["slack", "--mode", "everything"],
        "--mode takes allow-all, read-only, needs-approval",
      ],
      [["open-mcp", "--mode", "read-only"], "offers only --mode allow-all"],
    ];
    for (const [args, message] of cases) {
      await run(
        scope({
          list: async () => ok([readOnlySlack, openMcp]),
          setToolMode,
        }),
        args,
        EXIT_INVALID_INPUT,
      );
      expect(output.stderr).toContain(message);
    }
    expect(setToolMode).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: with tool access per agent on, an agent granted later starts with the stricter of the mode and the safe start, so the help of --mode on connect and on scope must not promise that the mode reaches it. Scope's --mode sets the agents that hold the connection now. */
  it("says in its help whom --mode reaches", () => {
    const helpOf = (command: Command) => {
      let help = "";
      command.configureOutput({ writeOut: (s) => (help += s) });
      command.outputHelp();
      return help.replace(/\s+/g, " ");
    };
    const scopeHelp = helpOf(scope({}));
    expect(scopeHelp).toContain(
      "It sets the agents that hold the connection now",
    );
    const connectHelp = helpOf(buildConnectCommand(deps({})));
    for (const help of [scopeHelp, connectHelp]) {
      expect(help).toContain("can start stricter");
      expect(help).toContain("the stricter of the mode and the safe start");
      expect(help).not.toContain("it can also post as you");
    }
  });

  /** TEST_SCENARIO: --mode means nothing on a connection with no MCP server, such as a GitHub App connection, so it is refused instead of ignored. */
  it("refuses --mode on a connection with no MCP server", async () => {
    await run(
      scope({ list: async () => ok([app]) }),
      ["my-app", "--mode", "read-only"],
      EXIT_INVALID_INPUT,
    );
    expect(output.stderr).toContain("--mode applies only to an MCP connection");
  });
});

describe("dam connection tools", () => {
  const listed = toolAccess({
    tools: [
      { name: "slack_search", readOnly: true },
      { name: "slack_send_message", readOnly: false },
    ],
    listedAt: "2026-11-20T10:00:00.000Z",
  });
  const tools = (svc: Partial<ConnectionService>) =>
    buildToolsCommand(deps(svc));

  /** TEST_SCENARIO: the owner checks what read only lets through, so the stored list prints grouped into read and write tools without asking the server again. */
  it("prints the stored list grouped into read and write tools", async () => {
    const refreshTools = vi.fn();
    const out = await run(
      tools({
        list: async () => ok([{ ...readOnlySlack, toolAccess: listed }]),
        refreshTools,
      }),
      ["slack"],
    );
    expect(out).toBe(
      "slack (conn-slack): read only\n" +
        "Listed at 2026-11-20T10:00:00.000Z\n" +
        "Read tools (1):\n  slack_search\n" +
        "Write tools (1):\n  slack_send_message\n",
    );
    expect(refreshTools).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: the server added tools since the connection was made, so --refresh reads the list again and prints what came back. */
  it("reads the list again on --refresh", async () => {
    const refreshTools = vi.fn(async () => ok(listed));
    const out = await run(
      tools({ list: async () => ok([readOnlySlack]), refreshTools }),
      ["slack", "--refresh", "--json"],
    );
    expect(refreshTools).toHaveBeenCalledWith("conn-slack");
    expect(JSON.parse(out)).toEqual({
      id: "conn-slack",
      name: "slack",
      toolAccess: listed,
    });
  });

  /** TEST_SCENARIO: a connection with no MCP server has no tools, so the command says so instead of printing an empty list. */
  it("refuses a connection with no MCP server", async () => {
    await run(
      tools({ list: async () => ok([app]) }),
      ["my-app"],
      EXIT_INVALID_INPUT,
    );
    expect(output.stderr).toContain("is not an MCP connection");
  });
});
