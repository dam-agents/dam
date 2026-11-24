// @vitest-environment happy-dom
// TEST_OVERVIEW: The web app's side of an MCP connection's tool mode, the one choice per connection while the `mcp-tool-approval` feature is off. The create form sends a mode only when the owner picks one. Only a Slack Account names its mode, in the read only / "Can post as me" words, in the line under its name and as a mark beside it when it can post; a connection still in needs approval keeps naming it so the owner can switch it away. With the feature on no connection names a mode and the connect form asks nothing, because tool access belongs to each Agent's grant. The warning before an agent is shared with a chat says what the people there can do through each such connection, from the connection's mode with the feature off and from the Agent's own grant with it on.
import type {
  AgentConnections,
  ConnectionTemplateView,
  ConnectionToolAccess,
  ConnectionView,
} from "api-server-api";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentView } from "../../types.js";

const flags = vi.hoisted(() => ({ "mcp-tool-approval": false }));
const server = vi.hoisted(() => ({
  connections: [] as unknown[],
  grants: undefined as unknown,
}));

vi.mock("../../modules/features/api/queries.js", () => ({
  useFeatures: () => ({ data: flags }),
}));
vi.mock("../../modules/connections/api/queries.js", () => ({
  useAppConnections: () => ({ data: server.connections }),
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgentConnections: (agentId: string | null) => ({
    data: agentId ? server.grants : undefined,
  }),
}));
vi.mock("../../modules/satellites/api/queries.js", () => ({
  useSatellites: () => ({ data: [] }),
}));

const { BindSharingText } =
  await import("../../modules/agents/components/bind/bind-sharing-text.js");
const { useAgentToolAccess } =
  await import("../../modules/agents/hooks/use-agent-shared-access.js");
const { StatusBadges } =
  await import("../../modules/connections/components/catalog-connection-row.js");
const { buildCreatePayload } =
  await import("../../modules/connections/lib/build-create-payload.js");
const { connectionDetail } =
  await import("../../modules/connections/lib/connection-detail.js");
const {
  connectionPickableToolModes,
  ownToolModeNames,
  pickableToolModes,
  toolModeCopy,
} = await import("../../modules/connections/lib/tool-mode.js");

const ALL_MODES = ["allow-all", "read-only", "needs-approval"] as const;

const SLACK_TEMPLATE: ConnectionTemplateView = {
  id: "slack",
  name: "Slack Account",
  category: "app",
  isCustom: false,
  authKind: "oauth",
  inputs: [],
  toolAccess: { defaultMode: "read-only", modes: ALL_MODES },
};

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

const slack = (over: Partial<ConnectionToolAccess> = {}): ConnectionView =>
  ({
    id: "conn-slack",
    name: "my-slack",
    templateId: "slack",
    authKind: "oauth",
    status: "active",
    accountLabel: "ada@acme.example",
    toolAccess: toolAccess(over),
  }) as ConnectionView;

const customMcp = (over: Partial<ConnectionToolAccess> = {}): ConnectionView =>
  ({
    id: "conn-notes",
    name: "my-notes",
    templateId: "custom-mcp-none",
    authKind: "header",
    status: "active",
    toolAccess: toolAccess({
      mode: "allow-all",
      defaultMode: "allow-all",
      ...over,
    }),
  }) as ConnectionView;

const badges = (c: ConnectionView) =>
  renderToStaticMarkup(createElement(StatusBadges, { connection: c }));

const reach = (c: ConnectionView) =>
  connectionDetail(c, flags["mcp-tool-approval"]).reach?.text;

beforeEach(() => {
  flags["mcp-tool-approval"] = false;
});

describe("connecting an MCP server", () => {
  const create = (toolMode?: "allow-all" | "needs-approval") =>
    buildCreatePayload(SLACK_TEMPLATE, {
      name: "my-slack",
      fields: {},
      overrideDefaults: false,
      ...(toolMode ? { toolMode } : {}),
    });

  // TEST_SCENARIO: a create the owner did not change must leave the mode to the server, which gives the Template's default; a mode the owner picked is sent as it is.
  it("sends a mode only when the owner picks one", () => {
    expect(create()).not.toHaveProperty("toolMode");
    expect(create("allow-all")).toMatchObject({ toolMode: "allow-all" });
    expect(create("needs-approval")).toMatchObject({
      toolMode: "needs-approval",
    });
  });
});

describe("a Slack Account's row with the feature off", () => {
  // TEST_SCENARIO: read only is the default, so it adds no mark beside the name; the line under the name says it in the words the row had before tool modes.
  it("says read only in its line", () => {
    expect(badges(slack())).toBe("");
    expect(connectionDetail(slack(), false)).toEqual({
      account: "Acts as ada@acme.example",
      reach: { text: "Read only: searches and reads as you, posts nothing" },
    });
  });

  // TEST_SCENARIO: a Slack Account that can post as the owner keeps the "Can post as me" danger mark, not GitHub's "Full access".
  it("marks allow all as Can post as me", () => {
    const html = badges(slack({ mode: "allow-all" }));
    expect(html).toContain('data-testid="connection-full-access-conn-slack"');
    expect(html).toContain("Can post as me");
    expect(html).not.toContain("Full access");
    expect(reach(slack({ mode: "allow-all" }))).toBe(
      "Searches, reads and posts as you",
    );
  });

  // TEST_SCENARIO: with the feature off nothing about a generic MCP connection changes, so it names no mode and carries no mark.
  it("names no mode on a generic MCP connection", () => {
    expect(badges(customMcp({ mode: "read-only" }))).toBe("");
    expect(reach(customMcp({ mode: "read-only" }))).toBeUndefined();
  });
});

describe("a connection left in needs approval after the feature is turned off", () => {
  const cards = (c: ConnectionView) =>
    connectionPickableToolModes(c.toolAccess, false).map(
      (mode) => toolModeCopy(mode, ownToolModeNames(c.toolAccess)).label,
    );

  // TEST_SCENARIO: the gate still holds every call of a tool that does not read, so the row keeps the amber mark and its line, and the dialog shows needs approval as the current card beside the modes the owner can switch to: Slack's old names, the generic connection's own names.
  it("keeps showing needs approval so the owner can switch it away", () => {
    for (const c of [
      slack({ mode: "needs-approval" }),
      customMcp({ mode: "needs-approval" }),
    ]) {
      const html = badges(c);
      expect(html).toContain("Needs approval");
      expect(html).toContain("bg-warning");
      expect(reach(c)).toBe(
        "Needs approval: the tools that read go through, every other tool waits for an answer",
      );
    }
    expect(cards(slack({ mode: "needs-approval" }))).toEqual([
      "Read only",
      "Needs approval",
      "Can post as me",
    ]);
    expect(cards(customMcp({ mode: "needs-approval" }))).toEqual([
      "Read only",
      "Needs approval",
      "Allow all",
    ]);
  });

  // TEST_SCENARIO: once the owner switches away, needs approval is no longer offered: a Slack Account is back to its two-way choice and a generic MCP connection names no mode again.
  it("stops offering needs approval once it is switched away", () => {
    expect(cards(slack({ mode: "read-only" }))).toEqual([
      "Read only",
      "Can post as me",
    ]);
    expect(cards(customMcp({ mode: "read-only" }))).toEqual([]);
  });
});

describe("an MCP connection's row with the feature on", () => {
  beforeEach(() => {
    flags["mcp-tool-approval"] = true;
  });

  // TEST_SCENARIO: tool access belongs to each Agent's grant, so no connection names a mode, carries a mode mark or offers the choice per connection, whatever mode it was left in.
  it("names no mode on any MCP connection", () => {
    for (const c of [
      slack(),
      slack({ mode: "allow-all" }),
      customMcp(),
      customMcp({ mode: "needs-approval" }),
    ]) {
      expect(badges(c)).toBe("");
      expect(reach(c)).toBeUndefined();
      expect(connectionPickableToolModes(c.toolAccess, true)).toEqual([]);
    }
  });

  // TEST_SCENARIO: the connect form asks nothing about access for a Slack Account, which only offered the choice with the feature off.
  it("asks nothing at connect", () => {
    expect(pickableToolModes(SLACK_TEMPLATE.toolAccess, true)).toEqual([]);
    expect(pickableToolModes(SLACK_TEMPLATE.toolAccess, false)).toEqual([
      "read-only",
      "allow-all",
    ]);
  });

  // TEST_SCENARIO: a GitHub connection keeps its own "Full access" mark, which is not a tool mode.
  it("keeps GitHub's full access mark", () => {
    const github = {
      id: "conn-gh",
      name: "github",
      templateId: "github",
      authKind: "oauth",
      status: "active",
      fullAccess: true,
    } as ConnectionView;
    expect(badges(github)).toContain("Full access");
  });
});

describe("sharing an agent that holds MCP connections with a chat", () => {
  const text = (
    connections: { name: string; reach: "reads" | "asks" | "writes" }[],
  ) => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      createElement(BindSharingText, {
        agentName: "helper",
        connectionNames: connections.map((c) => c.name),
        toolAccess: connections,
        audience: {
          kind: "slack-channel",
          id: "C1",
          name: "team",
        } as never,
        whisper: false,
      }),
    );
    return host.textContent ?? "";
  };

  // TEST_SCENARIO: a read-only Slack Account still lets the people in the chat read the owner's Slack through the agent, so the warning stays and says exactly that, and that nothing can be changed.
  it("says a read-only connection lets them read and change nothing", () => {
    const shown = text([{ name: "my-slack", reach: "reads" }]);
    expect(shown).toContain("ask it to use it, with your access.");
    expect(shown).toContain(
      "my-slack is read only: through it they can read what you can read, and change nothing.",
    );
    expect(shown).not.toContain("post");
  });

  // TEST_SCENARIO: with allow all the people in the chat can make the agent post as the owner, and with needs approval they can read while every other call waits for someone, so the warning says each.
  it("says what allow all and needs approval let them do", () => {
    const shown = text([
      { name: "my-slack", reach: "writes" },
      { name: "my-notes", reach: "asks" },
    ]);
    expect(shown).toContain(
      "Through my-slack they can also post and change things as you.",
    );
    expect(shown).toContain(
      "Through my-notes they can read what you can read, and every other tool call waits until someone approves it.",
    );
  });

  const sharedAccess = () => {
    let shared: ReturnType<typeof useAgentToolAccess> = null;
    function Probe() {
      shared = useAgentToolAccess({
        id: "agent-standup",
        grantedConnectionIds: ["conn-slack", "conn-notes"],
      } as AgentView);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe)));
    act(() => root.unmount());
    return shared;
  };

  // TEST_SCENARIO: with the feature on the warning reads this Agent's own grant of each connection, not the connection's mode: a Slack Account left in allow all that this Agent may only read is read only here, and a connection where this Agent writes without asking says so.
  it("reads the Agent's own grant with the feature on", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    server.connections = [slack({ mode: "allow-all" }), customMcp()];
    server.grants = {
      agentId: "agent-standup",
      connections: [
        {
          connectionId: "conn-slack",
          grantedAt: "2026-11-24T00:00:00Z",
          preferred: false,
          toolAccess: { read: "allow", write: "block", overrides: {} },
        },
        {
          connectionId: "conn-notes",
          grantedAt: "2026-11-24T00:00:00Z",
          preferred: false,
          toolAccess: { read: "allow", write: "allow", overrides: {} },
        },
      ],
    } satisfies AgentConnections;

    expect(sharedAccess()).toEqual([{ name: "my-slack", reach: "writes" }]);

    flags["mcp-tool-approval"] = true;
    expect(sharedAccess()).toEqual([
      { name: "my-slack", reach: "reads" },
      { name: "my-notes", reach: "writes" },
    ]);
  });
});
