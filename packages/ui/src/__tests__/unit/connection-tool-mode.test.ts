// @vitest-environment happy-dom
// TEST_OVERVIEW: The web app's side of an MCP connection's tool mode. The create form sends a mode only when the owner picks one. Each row names the mode in the line under its name, and marks allow all on a Template that defaults to read only, such as a Slack Account, and needs approval. With the `mcp-tool-approval` feature off, only a Slack Account names its mode, in the read only / "Can post as me" words it had before, and a connection still in needs approval keeps naming it so the owner can switch it away; with it on, every MCP connection that offers a choice does. The warning before an agent is shared with a chat says what the people there can do through each such connection.
import type {
  ConnectionTemplateView,
  ConnectionToolAccess,
  ConnectionView,
} from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ "mcp-tool-approval": false }));

vi.mock("../../modules/features/api/queries.js", () => ({
  useFeatures: () => ({ data: flags }),
}));

const { BindSharingText } =
  await import("../../modules/agents/components/bind/bind-sharing-text.js");
const { StatusBadges } =
  await import("../../modules/connections/components/catalog-connection-row.js");
const { buildCreatePayload } =
  await import("../../modules/connections/lib/build-create-payload.js");
const { connectionDetail } =
  await import("../../modules/connections/lib/connection-detail.js");
const { connectionPickableToolModes, ownToolModeNames, toolModeCopy } =
  await import("../../modules/connections/lib/tool-mode.js");

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
      (mode) => toolModeCopy(mode, ownToolModeNames(c.toolAccess, false)).label,
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

  // TEST_SCENARIO: a Slack Account set to allow all can post as the owner, which its Template does not do by default, so it carries the danger mark under the mode's own name.
  it("marks allow all on a Template that defaults to read only", () => {
    const html = badges(slack({ mode: "allow-all" }));
    expect(html).toContain("Allow all");
    expect(html).not.toContain("Can post as me");
    expect(reach(slack({ mode: "allow-all" }))).toBe(
      "Allow all: every tool call goes through",
    );
  });

  // TEST_SCENARIO: allow all is a generic MCP connection's default, so it carries no mark; its line still names the mode.
  it("leaves the default allow all of a generic MCP connection unmarked", () => {
    expect(badges(customMcp())).toBe("");
    expect(reach(customMcp())).toBe("Allow all: every tool call goes through");
    expect(reach(customMcp({ mode: "read-only" }))).toBe(
      "Read only: only the tools that read, every other tool refused",
    );
  });

  // TEST_SCENARIO: needs approval holds every call of a tool that does not read, so the owner sees the amber mark and the line says reads go through and every other call waits.
  it("marks needs approval in amber", () => {
    const html = badges(customMcp({ mode: "needs-approval" }));
    expect(html).toContain("Needs approval");
    expect(html).toContain("bg-warning");
    expect(reach(customMcp({ mode: "needs-approval" }))).toBe(
      "Needs approval: the tools that read go through, every other tool waits for an answer",
    );
  });

  // TEST_SCENARIO: an MCP server with no auth offers allow all alone, so its row names no mode and carries no mark; a GitHub connection keeps its own "Full access" mark.
  it("names nothing where there is nothing to pick", () => {
    const open = customMcp({ modes: ["allow-all"] });
    expect(badges(open)).toBe("");
    expect(reach(open)).toBeUndefined();
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
    modes: {
      name: string;
      mode: "read-only" | "allow-all" | "needs-approval";
    }[],
  ) => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      createElement(BindSharingText, {
        agentName: "helper",
        connectionNames: modes.map((c) => c.name),
        toolModes: modes,
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
    const shown = text([{ name: "my-slack", mode: "read-only" }]);
    expect(shown).toContain("ask it to use it, with your access.");
    expect(shown).toContain(
      "my-slack is read only: through it they can read what you can read, and change nothing.",
    );
    expect(shown).not.toContain("post");
  });

  // TEST_SCENARIO: with allow all the people in the chat can make the agent post as the owner, and with needs approval they can read while every other call waits for someone, so the warning says each.
  it("says what allow all and needs approval let them do", () => {
    const shown = text([
      { name: "my-slack", mode: "allow-all" },
      { name: "my-notes", mode: "needs-approval" },
    ]);
    expect(shown).toContain(
      "Through my-slack they can also post and change things as you.",
    );
    expect(shown).toContain(
      "Through my-notes they can read what you can read, and every other tool call waits until someone approves it.",
    );
  });
});
