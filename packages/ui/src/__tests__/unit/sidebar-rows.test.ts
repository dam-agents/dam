// TEST_OVERVIEW: The classic sidebar marks unread work in blue with a text equivalent: on an unread Session row, and on the row of an Agent with an unread Session. An Activity row names its Agent with the Agent's avatar beside the name. An Agent row whose Sessions are closed keeps its unread marker and is not highlighted when its chat shows a Session. A revealed Agent row hides its blue dot, so it never sits on an action, and a filtered row keeps the dot at the right end with the filter icon next to it.
import { SessionMode, SessionType } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AgentView, SessionView } from "../../types.js";

vi.stubGlobal("window", new EventTarget());

vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgent: () => null,
  useAgentsList: () => [],
}));
vi.mock("../../modules/agents/hooks/use-auto-wake-on-sidebar-open.js", () => ({
  useAutoWakeOnSidebarOpen: () => {},
}));
vi.mock("../../modules/agents/hooks/use-order-drag.js", () => ({
  useOrderDrag: () => ({ dragProps: {}, indicator: null }),
}));

const { SidebarAgentRow } =
  await import("../../modules/agents/components/sidebar-agent-row.js");
const { SessionRow } =
  await import("../../modules/sessions/components/session-row.js");

const agent = {
  id: "a-1",
  name: "Reviewer",
  avatar: null,
  state: "running",
  access: { role: "owner", editors: [] },
} as unknown as AgentView;

const agentRow = (props: {
  viewing: boolean;
  selected: boolean;
  actionCount?: 2 | 3;
  filtered?: boolean;
  unread?: boolean;
}) =>
  renderToStaticMarkup(
    createElement(SidebarAgentRow, {
      agent,
      current: false,
      unread: true,
      orderReady: true,
      onMove: () => {},
      onStep: () => {},
      onSelect: () => {},
      onOpenPeople: () => {},
      actions: null,
      actionCount: 2,
      filtered: false,
      ...props,
    }),
  );

describe("unread markers", () => {
  it("TEST_SCENARIO: an unread Session row shows a blue dot labelled Unread", () => {
    const html = renderToStaticMarkup(
      createElement(SessionRow, {
        session: {
          agentId: "a-1",
          sessionId: "s-1",
          title: "Fix the build",
          type: SessionType.Regular,
          mode: SessionMode.Chat,
        } as unknown as SessionView,
        active: false,
        working: false,
        needsApproval: false,
        unread: true,
        onResume: () => {},
        onRename: () => {},
        onDelete: () => {},
      }),
    );
    expect(html).toMatch(
      /aria-label="Unread"[^>]*bg-accent|bg-accent[^>]*aria-label="Unread"/,
    );
  });

  it("TEST_SCENARIO: an Agent with an unread Session shows a blue dot and says so to a screen reader", () => {
    const html = agentRow({ viewing: false, selected: false });
    expect(html).toContain("bg-accent");
    expect(html).toContain("(unread)");
  });

  it("TEST_SCENARIO: the Agent the sidebar is narrowed to keeps its blue dot visible, because its unread Session may sit below the five rows it lists", () => {
    const html = agentRow({ viewing: true, selected: true });
    expect(html).toMatch(
      /<span aria-hidden="true" class="[^"]*"><span class="[^"]*bg-accent/,
    );
    expect(html).not.toMatch(
      /<span aria-hidden="true" class="[^"]*\bhidden\b[^"]*"><span class="[^"]*bg-accent/,
    );
  });

  it("TEST_SCENARIO: an Agent the sidebar is not narrowed to is not highlighted and keeps its actions hidden until hover", () => {
    expect(agentRow({ viewing: false, selected: false })).not.toContain(
      "opacity-100 pr-",
    );
    expect(agentRow({ viewing: false, selected: false })).not.toContain(
      'aria-current="page"',
    );
    expect(agentRow({ viewing: true, selected: true })).toContain("pr-[60px]");
  });

  it("TEST_SCENARIO: an Agent with a channel kebab reserves room for three controls", () => {
    const html = agentRow({ viewing: true, selected: true, actionCount: 3 });
    expect(html).toContain("pr-[86px]");
    expect(html).not.toContain("pr-[60px]");
  });

  const unreadDotClass = (html: string) =>
    /<span aria-hidden="true" class="([^"]*)"><span class="[^"]*bg-accent/.exec(
      html,
    )?.[1] ?? "";
  it("TEST_SCENARIO: an unselected Agent whose actions show because it has focus or an open menu hides its blue dot and makes room for them, so the dot never sits on Configure agent", () => {
    const html = agentRow({ viewing: false, selected: false, actionCount: 3 });
    for (const reveal of [
      "group-hover/agent",
      "group-focus-within/agent",
      "group-has-[[data-state=open]]/agent",
    ]) {
      expect(unreadDotClass(html)).toContain(`${reveal}:hidden`);
      expect(html).toContain(`${reveal}:pr-[86px]`);
    }
  });

  const filteredMarkClass = (html: string) =>
    /<span data-testid="sidebar-agent-filtered" title="Sessions filtered" class="([^"]*)"/.exec(
      html,
    )?.[1] ?? "";

  it("TEST_SCENARIO: an Agent with a saved session filter shows a filter mark, so the user knows its agent view opens filtered", () => {
    const html = agentRow({ viewing: false, selected: false, filtered: true });
    expect(html).toContain('data-testid="sidebar-agent-filtered"');
    expect(html).toContain("(sessions filtered)");
    expect(agentRow({ viewing: false, selected: false })).not.toContain(
      "sidebar-agent-filtered",
    );
  });

  it("TEST_SCENARIO: the filter mark makes room for the actions on an unselected Agent and stays on the selected one", () => {
    expect(
      filteredMarkClass(
        agentRow({ viewing: false, selected: false, filtered: true }),
      ),
    ).toContain("group-hover/agent:hidden");
    expect(
      filteredMarkClass(
        agentRow({ viewing: true, selected: true, filtered: true }),
      ),
    ).not.toContain("group-hover/agent:hidden");
  });
});

describe("a Session row in All agents", () => {
  it("TEST_SCENARIO: the row names its Agent, with the Agent's avatar beside the name, before the time", () => {
    const html = renderToStaticMarkup(
      createElement(SessionRow, {
        session: {
          agentId: "a-1",
          sessionId: "s-1",
          title: "Fix the build",
          type: SessionType.Regular,
          mode: SessionMode.Chat,
          createdAt: "2026-10-20T08:00:00Z",
        } as unknown as SessionView,
        agent: { name: "Reviewer", avatar: null },
        active: false,
        working: false,
        needsApproval: false,
        onResume: () => {},
        onRename: () => {},
        onDelete: () => {},
      }),
    );
    expect(html).toMatch(
      /data-testid="session-agent"[^]*data-testid="agent-avatar"[^]*Reviewer/,
    );
  });
});
