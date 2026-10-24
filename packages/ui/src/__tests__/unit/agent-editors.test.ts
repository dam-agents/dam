// TEST_OVERVIEW: An owner always sees which of their agents are Shared Agents and with whom: the sidebar row of a shared agent carries a people mark whose tooltip names the Agent Editors, the first five and a count of the rest. The agent's People section sums up who works on it, from the owner's side and from an editor's, and an editor's page names the owner.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AgentView } from "../../types.js";

vi.stubGlobal("window", new EventTarget());

vi.mock("../../modules/agents/hooks/use-auto-wake-on-sidebar-open.js", () => ({
  useAutoWakeOnSidebarOpen: () => {},
}));
vi.mock("../../modules/agents/hooks/use-order-drag.js", () => ({
  useOrderDrag: () => ({ dragProps: {}, indicator: null }),
}));

const { editorsTooltip, ownerLine, peopleSummary } =
  await import("../../modules/agents/lib/agent-editors.js");
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
          access: { role: "owner", editors },
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
        actionCount: 3,
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
    expect(peopleSummary({ role: "owner", editors: [] })).toBe("Only you");
    expect(
      peopleSummary({ role: "owner", editors: ["a@example.com", "b@x.io"] }),
    ).toBe("2 editors");
  });

  it("TEST_SCENARIO: an editor's summary counts the owner and the editors", () => {
    expect(
      peopleSummary({
        role: "editor",
        ownerEmail: "jordan@example.com",
        editors: ["a@example.com", "b@example.com"],
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
