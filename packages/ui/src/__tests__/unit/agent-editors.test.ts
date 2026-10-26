// TEST_OVERVIEW: An owner always sees which of their agents are Shared Agents and with whom: the sidebar row of a shared agent carries a people mark whose tooltip names the Agent Editors, the first five and a count of the rest. The agent's People section sums up who works on it, from the owner's side and from an editor's, an editor's page names the owner, and the owner is warned what an editor can do before adding one.
import { AGENT_PERMISSIONS } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AgentView } from "../../types.js";

const OWNS = [...AGENT_PERMISSIONS];

vi.stubGlobal("window", new EventTarget());

vi.mock("../../modules/agents/hooks/use-auto-wake-on-sidebar-open.js", () => ({
  useAutoWakeOnSidebarOpen: () => {},
}));
vi.mock("../../modules/agents/hooks/use-order-drag.js", () => ({
  useOrderDrag: () => ({ dragProps: {}, indicator: null }),
}));

const {
  EDITORS_WARNING,
  editorsTooltip,
  editorsWarning,
  ownerLine,
  peopleSummary,
} = await import("../../modules/agents/lib/agent-editors.js");
const { actingConnectionNames } =
  await import("../../modules/agents/lib/owner-connections.js");
const { TooltipProvider } = await import("../../components/ui/tooltip.js");
const { SidebarAgentRow } =
  await import("../../modules/agents/components/sidebar-agent-row.js");

const row = (editors: string[]) =>
  renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(SidebarAgentRow, {
        agent: {
          id: "a-1",
          name: "Release helper",
          avatar: null,
          state: "running",
          access: { role: "owner", editors, permissions: OWNS },
        } as unknown as AgentView,
        open: false,
        selected: false,
        current: false,
        unread: false,
        orderReady: true,
        onMove: () => {},
        onStep: () => {},
        onSelect: () => {},
        onOpenPeople: () => {},
        actions: null,
        filter: null,
        filtered: false,
      }),
    ),
  );

describe("the owner's sidebar row", () => {
  it("TEST_SCENARIO: a shared agent's row carries a people mark labelled with how many editors it has", () => {
    expect(row(["alex@example.com", "sam@example.com"])).toContain(
      'aria-label="Shared with 2 editors"',
    );
  });

  it("TEST_SCENARIO: an agent with no editors carries no people mark", () => {
    expect(row([])).not.toContain("sidebar-agent-shared");
  });
});

describe("the editors tooltip", () => {
  it("TEST_SCENARIO: a long Editor List shows its first five emails and how many more there are", () => {
    const editors = Array.from({ length: 7 }, (_, i) => `e${i}@example.com`);
    expect(editorsTooltip(editors)).toEqual({
      title: "Shared with 7 editors",
      shown: editors.slice(0, 5),
      more: 2,
    });
  });

  it("TEST_SCENARIO: one editor reads in the singular", () => {
    expect(editorsTooltip(["alex@example.com"]).title).toBe(
      "Shared with 1 editor",
    );
  });
});

describe("who works on an agent", () => {
  it("TEST_SCENARIO: the owner's summary says it is only them, or how many editors there are", () => {
    expect(
      peopleSummary({ role: "owner", editors: [], permissions: OWNS }),
    ).toBe("Only you");
    expect(
      peopleSummary({
        role: "owner",
        editors: ["a@example.com", "b@x.io"],
        permissions: OWNS,
      }),
    ).toBe("2 editors");
  });

  it("TEST_SCENARIO: an editor's summary counts the owner and the editors", () => {
    expect(
      peopleSummary({
        role: "editor",
        ownerEmail: "jordan@example.com",
        editors: ["a@example.com", "b@example.com"],
        permissions: [],
      }),
    ).toBe("Owner + 2 editors");
  });

  it("TEST_SCENARIO: an editor's page names the owner, or a former user when the owner's account is gone", () => {
    expect(ownerLine("jordan@example.com")).toBe(
      "Owned by jordan@example.com · you're an editor",
    );
    expect(ownerLine(null)).toBe("Owned by a former user · you're an editor");
  });
});

describe("the owner's warning in People", () => {
  // TEST_SCENARIO: editors now work in sessions, so the warning says they can use and delete every session, the owner's too, read and change files and environment variables, approve actions with the owner's connections, and that their use counts toward the owner's own spend limits.
  it("says what an editor can do", () => {
    expect(EDITORS_WARNING).toMatch(
      /use and delete every session with this agent, yours included/,
    );
    expect(EDITORS_WARNING).toMatch(
      /read and change its files and environment variables/,
    );
    expect(EDITORS_WARNING).toMatch(
      /approve actions it takes with your connections/,
    );
    expect(EDITORS_WARNING).toMatch(/counts toward your own spend limits/);
  });
});

describe("the connections the warning in People names", () => {
  // TEST_SCENARIO: AC-6 — an agent with GitHub acting as tomkis, Google Drive acting as an email, and Linear names each, with its account when known, and leaves out the model provider.
  it("names each connection as its account", () => {
    const names = actingConnectionNames([
      { name: "GitHub", templateId: "github", accountLabel: "tomkis" },
      {
        name: "Google Drive",
        templateId: "google-drive",
        accountLabel: "tomas@example.com",
      },
      { name: "Anthropic", templateId: "anthropic" },
      { name: "Linear", templateId: "linear" },
    ]);
    const warning = editorsWarning(names);
    expect(warning.text).toContain(
      "approve actions it takes with your connections: GitHub as tomkis, Google Drive as tomas@example.com, Linear. Their use counts toward your own spend limits.",
    );
    expect(warning.connections?.more).toBe(0);
  });

  // TEST_SCENARIO: AC-6 — more than three connections show three and count the rest; the tooltip lists them all.
  it("shows more than three in a tooltip", () => {
    const names = ["GitHub as tomkis", "Slack", "Linear", "Notion", "Jira"];
    const warning = editorsWarning(names);
    expect(warning.text).toContain(
      "with your connections: GitHub as tomkis, Slack, Linear and 2 more.",
    );
    expect(warning.connections).toMatchObject({ names, more: 2 });
  });

  // TEST_SCENARIO: AC-7 — an agent with no connections but model providers keeps today's warning word for word.
  it("keeps today's warning without connections", () => {
    expect(editorsWarning([])).toEqual({
      text: EDITORS_WARNING,
      connections: null,
    });
  });
});
