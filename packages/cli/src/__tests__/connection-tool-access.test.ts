// TEST_OVERVIEW: Tool access of one Agent on one MCP connection, kept on the grant. Each tool is allow, ask or block: --read sets the rule of the read tools, --write the rule of every other tool, and --tool gives one tool its own rule. `dam connection scope <connection> --agent <agent>` shows that access, and with the flags reads the grant's current access, changes only what the flags name, sends it with setGrantToolAccess for that one Agent and prints what the server stored. `dam connection list <agent>` shows the access in the SCOPE column and carries grantToolAccess in --json, `dam connection tools --agent` prints each tool with its rule, and `dam connection grant` prints what the Agent starts with.
import type {
  ConnectionToolAccess,
  GrantToolAccess,
  ToolRule,
} from "api-server-api";
import { describe, expect, it, vi } from "vitest";
import type { AgentView } from "../modules/agent/domain/agent-view.js";
import { buildGrantCommand } from "../modules/connection/commands/grant.js";
import { buildListCommand } from "../modules/connection/commands/list.js";
import { buildScopeCommand } from "../modules/connection/commands/scope.js";
import { buildToolsCommand } from "../modules/connection/commands/tools.js";
import type { AgentGrant } from "../modules/connection/domain/default-account.js";
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

const STANDUP = "agent-000000000000000a";
const SCOUT = "agent-000000000000000b";

const agent = (id: string, name: string): AgentView => ({
  id,
  name,
  templateId: null,
  image: "",
  state: "running",
  channels: [],
});

const agents = {
  list: async () => ok([agent(STANDUP, "standup"), agent(SCOUT, "scout")]),
};

const connectionAccess = (
  over: Partial<ConnectionToolAccess> = {},
): ConnectionToolAccess => ({
  mode: "read-only",
  modes: ["allow-all", "read-only", "needs-approval"],
  defaultMode: "read-only",
  tools: [
    { name: "slack_search", readOnly: true },
    { name: "slack_add_reaction", readOnly: false },
    { name: "slack_send_message", readOnly: false },
  ],
  listedAt: "2026-11-24T10:00:00.000Z",
  listError: null,
  ...over,
});

const slackAccount = view({
  id: "conn-slack",
  name: "slack-account",
  templateId: "slack",
  toolAccess: connectionAccess(),
});
const openMcp = view({
  id: "conn-open",
  name: "open-mcp",
  templateId: "custom-mcp-none",
  category: "mcp",
  toolAccess: connectionAccess({
    mode: "allow-all",
    modes: ["allow-all"],
    defaultMode: "allow-all",
    tools: null,
  }),
});

const access = (
  read: ToolRule,
  write: ToolRule,
  overrides: Record<string, ToolRule> = {},
): GrantToolAccess => ({ read, write, overrides });

const READ_ONLY = access("allow", "block");

const grant = (
  connectionId: string,
  toolAccess?: GrantToolAccess,
): AgentGrant => ({
  connectionId,
  grantedAt: "2026-11-24T09:00:00Z",
  preferred: false,
  ...(toolAccess && { toolAccess }),
});

const service = (
  grants: readonly AgentGrant[],
  over: Partial<ConnectionService> = {},
) => ({
  list: async () => ok([slackAccount, openMcp, app]),
  ...over,
  agentGrants: vi.fn<ConnectionService["agentGrants"]>(async () => ok(grants)),
  setGrantToolAccess: vi.fn(async () => ok(undefined)),
  setToolMode: vi.fn(async () => ok(undefined)),
});

const scope = (svc: Partial<ConnectionService>) =>
  buildScopeCommand(deps(svc, agents));

describe("dam connection scope --agent", () => {
  /** TEST_SCENARIO: the owner lets one Agent ask before it writes to Slack and add reactions freely. Only that Agent's grant is sent, the read rule it had stays, and the Connection-wide mode is not touched. */
  it("changes one agent's access and keeps what the flags leave out", async () => {
    const svc = service([grant("conn-slack", READ_ONLY)]);
    svc.agentGrants
      .mockResolvedValueOnce(ok([grant("conn-slack", READ_ONLY)]))
      .mockResolvedValueOnce(
        ok([
          grant(
            "conn-slack",
            access("allow", "ask", { slack_add_reaction: "allow" }),
          ),
        ]),
      );
    const out = await run(scope(svc), [
      "slack-account",
      "--agent",
      "standup",
      "--write",
      "ask",
      "--tool",
      "slack_add_reaction=allow",
    ]);
    expect(svc.setGrantToolAccess).toHaveBeenCalledExactlyOnceWith({
      agentId: STANDUP,
      connectionId: "conn-slack",
      access: access("allow", "ask", { slack_add_reaction: "allow" }),
    });
    expect(svc.agentGrants).toHaveBeenCalledWith(STANDUP);
    expect(svc.setToolMode).not.toHaveBeenCalled();
    expect(out).toBe(
      "✓ Set slack-account (conn-slack) for standup: asks before writing, 1 exception\n" +
        "  Read tools: allow\n" +
        "  Write tools and tools not in the list: ask\n" +
        "  Exception: slack_add_reaction allow\n",
    );
  });

  /** TEST_SCENARIO: --reset-tool drops a tool's own rule so it follows its group again, while the other exceptions and both group rules stay as they were. */
  it("drops a tool's own rule with --reset-tool", async () => {
    const current = access("allow", "ask", {
      slack_add_reaction: "allow",
      slack_send_message: "block",
    });
    const svc = service([grant("conn-slack", current)]);
    await run(scope(svc), [
      "slack-account",
      "--agent",
      "standup",
      "--reset-tool",
      "slack_add_reaction",
      "--json",
    ]);
    expect(svc.setGrantToolAccess).toHaveBeenCalledWith({
      agentId: STANDUP,
      connectionId: "conn-slack",
      access: access("allow", "ask", { slack_send_message: "block" }),
    });
  });

  /** TEST_SCENARIO: the server drops an exception equal to its group's rule, so the command prints what the server stored, not what it sent. */
  it("prints the access the server stored", async () => {
    const svc = service([]);
    svc.agentGrants
      .mockResolvedValueOnce(ok([grant("conn-slack", READ_ONLY)]))
      .mockResolvedValueOnce(ok([grant("conn-slack", access("allow", "ask"))]));
    const out = await run(scope(svc), [
      "slack-account",
      "--agent",
      "standup",
      "--write",
      "ask",
      "--tool",
      "slack_send_message=ask",
      "--json",
    ]);
    expect(JSON.parse(out)).toEqual({
      ok: true,
      id: "conn-slack",
      name: "slack-account",
      kind: "grant-tool-access",
      agentId: STANDUP,
      agentName: "standup",
      grantToolAccess: access("allow", "ask"),
    });
  });

  /** TEST_SCENARIO: with --agent and no rule flag the command only shows that Agent's access, and says how to change it. */
  it("shows the access and changes nothing without a rule flag", async () => {
    const svc = service([grant("conn-slack", READ_ONLY)]);
    const out = await run(scope(svc), ["slack-account", "--agent", "standup"]);
    expect(out.split("\n")[0]).toBe(
      "slack-account (conn-slack) for standup: read only",
    );
    expect(output.stderr).toContain(
      "dam connection scope slack-account --agent standup --write",
    );
    expect(svc.setGrantToolAccess).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: an Agent that can post as the owner without asking is a risk the owner must see, so the command says it on stderr, also when only one write tool is allowed. */
  it("notes when the agent writes without asking", async () => {
    const svc = service([
      grant(
        "conn-slack",
        access("allow", "ask", { slack_send_message: "allow" }),
      ),
    ]);
    await run(scope(svc), ["slack-account", "--agent", "standup"]);
    expect(output.stderr).toContain(
      "note: standup calls some tools of slack-account that post or change things as you without asking",
    );
  });

  /** TEST_SCENARIO: a mistyped tool name would set a rule that never matches a call, so the command warns that the name is not in the stored list, and still sends it, since the list can be out of date. */
  it("warns about a tool the stored list does not name", async () => {
    const svc = service([grant("conn-slack", READ_ONLY)]);
    await run(scope(svc), [
      "slack-account",
      "--agent",
      "standup",
      "--tool",
      "slack_add_reacton=allow",
    ]);
    expect(output.stderr).toContain(
      "warning: slack_add_reacton is not in the tool list of slack-account",
    );
    expect(svc.setGrantToolAccess).toHaveBeenCalledOnce();
  });

  /** TEST_SCENARIO: each flag mix that means nothing, or two things at once, is refused before anything is sent, so the owner never gets a half-applied change. */
  it("refuses flags that mean nothing or contradict each other", async () => {
    const cases: [string[], string][] = [
      [
        ["slack-account", "--write", "ask"],
        "set the tool access of one agent; pass --agent <agent>",
      ],
      [
        ["slack-account", "--agent", "standup", "--mode", "read-only"],
        "--mode sets the agents that hold the connection now, --agent one agent",
      ],
      [
        ["slack-account", "--agent", "standup", "--read", "maybe"],
        "--read takes allow|ask|block",
      ],
      [
        ["slack-account", "--agent", "standup", "--tool", "slack_search"],
        "--tool takes <name>=allow|ask|block, not 'slack_search'",
      ],
      [
        [
          "slack-account",
          "--agent",
          "standup",
          "--tool",
          "slack_search=allow",
          "--tool",
          "slack_search=block",
        ],
        "--tool gives slack_search two rules",
      ],
      [
        [
          "slack-account",
          "--agent",
          "standup",
          "--tool",
          "slack_search=allow",
          "--reset-tool",
          "slack_search",
        ],
        "--tool and --reset-tool both name slack_search",
      ],
      [
        ["slack-account", "--agent", "standup", "--repositories", "api"],
        "it has tool access, not a scope",
      ],
      [
        ["my-app", "--agent", "standup"],
        "--agent applies only to an MCP connection",
      ],
    ];
    for (const [args, message] of cases) {
      const svc = service([grant("conn-slack", READ_ONLY)]);
      await run(scope(svc), args, EXIT_INVALID_INPUT);
      expect(output.stderr).toContain(message);
      expect(svc.setGrantToolAccess).not.toHaveBeenCalled();
    }
  });

  /** TEST_SCENARIO: an Agent that does not hold the connection has no grant to change, so the command says so and names the grant command. */
  it("refuses an agent that does not hold the connection", async () => {
    const svc = service([]);
    await run(
      scope(svc),
      ["slack-account", "--agent", "standup", "--write", "ask"],
      EXIT_INVALID_INPUT,
    );
    expect(output.stderr).toContain("standup does not hold slack-account");
    expect(output.stderr).toContain(
      "dam connection grant standup --connection slack-account",
    );
    expect(svc.setGrantToolAccess).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: the server sends no tool access on a grant of an MCP server with no auth, because the gateway does not read its requests, so the command says there is nothing to set. */
  it("refuses a connection whose grant has no tool access", async () => {
    const svc = service([grant("conn-open")]);
    await run(
      scope(svc),
      ["open-mcp", "--agent", "standup", "--write", "ask"],
      EXIT_INVALID_INPUT,
    );
    expect(output.stderr).toContain("open-mcp has no tool access to set");
    expect(svc.setGrantToolAccess).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: with tool access per agent off for the person, the server sends no access on a Slack Account grant either; the command names the feature as the cause and points to the Connection's tool mode, and never says that every call passes. */
  it("names the feature when the server sends no access on a connection the gateway reads", async () => {
    const svc = service([grant("conn-slack")]);
    await run(
      scope(svc),
      ["slack-account", "--agent", "standup", "--write", "ask"],
      EXIT_INVALID_INPUT,
    );
    expect(output.stderr).toContain(
      "tool access per agent is an internal feature that is off for you",
    );
    expect(output.stderr).toContain(
      "dam connection scope slack-account --mode <mode>",
    );
    expect(output.stderr).not.toContain("every tool call passes");
    expect(svc.setGrantToolAccess).not.toHaveBeenCalled();
  });
});

describe("dam connection list <agent> on an MCP connection", () => {
  const grants = [
    grant(
      "conn-slack",
      access("allow", "ask", {
        slack_add_reaction: "allow",
        slack_send_message: "block",
      }),
    ),
    grant("conn-open"),
  ];

  /** TEST_SCENARIO: listed for one Agent, SCOPE says that Agent's own access in one short phrase, and a connection with no access of its own keeps its mode. */
  it("shows the agent's access in the SCOPE column", async () => {
    const out = await run(buildListCommand(deps(service(grants), agents)), [
      "standup",
    ]);
    const lines = out.split("\n");
    expect(lines.find((l) => l.startsWith("conn-slack"))).toContain(
      "asks before writing, 2 exceptions",
    );
    expect(lines.find((l) => l.startsWith("conn-open"))).toContain("allow all");
  });

  /** TEST_SCENARIO: a script reads the Agent's access from --json as grantToolAccess, next to the connection's own toolAccess. */
  it("carries grantToolAccess in --json", async () => {
    const out = await run(buildListCommand(deps(service(grants), agents)), [
      "standup",
      "--json",
    ]);
    const rows = JSON.parse(out) as {
      id: string;
      grantToolAccess?: GrantToolAccess;
      toolAccess?: ConnectionToolAccess;
    }[];
    const slack = rows.find((r) => r.id === "conn-slack");
    expect(slack?.grantToolAccess).toEqual(grants[0]!.toolAccess);
    expect(slack?.toolAccess?.mode).toBe("read-only");
    expect(rows.find((r) => r.id === "conn-open")).not.toHaveProperty(
      "grantToolAccess",
    );
  });
});

describe("dam connection tools --agent", () => {
  const svc = () =>
    service([
      grant(
        "conn-slack",
        access("allow", "ask", { slack_add_reaction: "allow" }),
      ),
    ]);

  /** TEST_SCENARIO: the owner checks what one Agent may do, so each tool prints with its rule for that Agent, an exception is marked, and the line at the end says what a tool the list does not name gets. */
  it("prints each tool with its rule for the agent", async () => {
    const out = await run(buildToolsCommand(deps(svc(), agents)), [
      "slack-account",
      "--agent",
      "standup",
    ]);
    expect(out).toBe(
      "slack-account (conn-slack) for standup: asks before writing, 1 exception\n" +
        "Listed at 2026-11-24T10:00:00.000Z\n" +
        "Read tools (1): allow\n" +
        "  slack_search        allow\n" +
        "Write tools (2): ask\n" +
        "  slack_add_reaction  allow (exception)\n" +
        "  slack_send_message  ask\n" +
        "A tool not in the list follows the write tools: ask.\n",
    );
  });

  /** TEST_SCENARIO: a script reads the rule of each listed tool by name from --json, with the Agent's access it came from. */
  it("carries the rule of each tool in --json", async () => {
    const out = await run(buildToolsCommand(deps(svc(), agents)), [
      "slack-account",
      "--agent",
      "standup",
      "--json",
    ]);
    const parsed = JSON.parse(out);
    expect(parsed.agentId).toBe(STANDUP);
    expect(parsed.grantToolAccess).toEqual(
      access("allow", "ask", { slack_add_reaction: "allow" }),
    );
    expect(parsed.rules).toEqual({
      slack_search: "allow",
      slack_add_reaction: "allow",
      slack_send_message: "ask",
    });
  });
});

describe("dam connection grant of an MCP connection", () => {
  /** TEST_SCENARIO: a new grant starts with the access the server gives it, read only for a Slack Account, so the grant prints it right away instead of leaving the owner to guess. */
  it("prints what the agent starts with", async () => {
    const svc = service([], {
      grant: async () => ok(["conn-slack"]),
    });
    svc.agentGrants.mockResolvedValue(ok([grant("conn-slack", READ_ONLY)]));
    const out = await run(buildGrantCommand(deps(svc, agents)), [
      "standup",
      "--connection",
      "slack-account",
    ]);
    expect(out).toContain(
      "Tool access of standup:\n  slack-account (conn-slack): read only\n",
    );
    expect(output.stderr).toContain(
      "dam connection scope <connection> --agent standup",
    );
  });

  /** TEST_SCENARIO: --json carries the starting access of each MCP connection granted in the call, keyed by connection id. */
  it("carries the starting access in --json", async () => {
    const svc = service([], { grant: async () => ok(["conn-slack"]) });
    svc.agentGrants.mockResolvedValue(ok([grant("conn-slack", READ_ONLY)]));
    const out = await run(buildGrantCommand(deps(svc, agents)), [
      "standup",
      "--connection",
      "slack-account",
      "--json",
    ]);
    expect(JSON.parse(out)).toEqual({
      ok: true,
      agentId: STANDUP,
      connectionIds: ["conn-slack"],
      grantToolAccess: { "conn-slack": READ_ONLY },
    });
  });
});
