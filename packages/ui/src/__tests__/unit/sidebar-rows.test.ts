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
const { SidebarActivityRow } =
  await import("../../modules/home/components/sidebar-activity-row.js");
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
  open: boolean;
  selected: boolean;
  actionCount?: 3 | 4;
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
      actionCount: 3,
      filter: createElement("span", { "data-filter": true }),
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
    const html = agentRow({ open: false, selected: false });
    expect(html).toContain("bg-accent");
    expect(html).toContain("(unread)");
  });

  it("TEST_SCENARIO: the shown, open Agent keeps its blue dot visible, because its unread Session may sit below the five rows it shows", () => {
    const html = agentRow({ open: true, selected: true });
    expect(html).toMatch(
      /<span aria-hidden="true" class="[^"]*"><span class="[^"]*bg-accent/,
    );
    expect(html).not.toMatch(
      /<span aria-hidden="true" class="[^"]*\bhidden\b[^"]*"><span class="[^"]*bg-accent/,
    );
  });

  it("TEST_SCENARIO: a closed Agent whose Session shows from Activity is not highlighted and keeps its actions hidden until hover", () => {
    expect(agentRow({ open: false, selected: false })).not.toContain(
      "opacity-100 pr-",
    );
    expect(agentRow({ open: false, selected: false })).not.toContain(
      'aria-current="page"',
    );
    expect(agentRow({ open: true, selected: true })).toContain("pr-[86px]");
  });

  it("TEST_SCENARIO: an Agent with a channel kebab reserves room for four controls", () => {
    const html = agentRow({ open: true, selected: true, actionCount: 4 });
    expect(html).toContain("pr-[112px]");
    expect(html).not.toContain("pr-[86px]");
  });

  const unreadDotClass = (html: string) =>
    /<span aria-hidden="true" class="([^"]*)"><span class="[^"]*bg-accent/.exec(
      html,
    )?.[1] ?? "";
  const filterClass = (html: string) =>
    /<div class="([^"]*)"><span data-filter="true"><\/span>/.exec(html)?.[1] ??
    "";

  it("TEST_SCENARIO: an unselected Agent whose actions show because it has focus or an open menu hides its blue dot and makes room for them, so the dot never sits on Configure agent", () => {
    const html = agentRow({ open: false, selected: false, actionCount: 4 });
    for (const reveal of [
      "group-hover/agent",
      "group-focus-within/agent",
      "group-has-[[data-state=open]]/agent",
    ]) {
      expect(unreadDotClass(html)).toContain(`${reveal}:hidden`);
      expect(html).toContain(`${reveal}:pr-[112px]`);
    }
  });

  it("TEST_SCENARIO: a filtered, unselected Agent with an unread Session keeps the blue dot at the right end, with the filter icon next to it", () => {
    const html = agentRow({ open: false, selected: false, filtered: true });
    expect(unreadDotClass(html)).toContain("ml-6");
    expect(html).not.toContain("pr-[34px]");
    expect(filterClass(html)).toMatch(/(^| )right-6( |$)/);
    expect(filterClass(html)).toContain("group-hover/agent:right-[56px]");
  });

  it("TEST_SCENARIO: a filtered Agent with nothing unread keeps the filter icon at the right end", () => {
    const html = agentRow({
      open: false,
      selected: false,
      filtered: true,
      unread: false,
    });
    expect(html).toContain("pr-[34px]");
    expect(filterClass(html)).toMatch(/(^| )right-1( |$)/);
  });

  it("TEST_SCENARIO: a selected Agent places the filter icon just left of its actions", () => {
    expect(
      filterClass(agentRow({ open: true, selected: true, filtered: true })),
    ).toMatch(/(^| )right-\[56px\]( |$)/);
    expect(
      filterClass(
        agentRow({
          open: true,
          selected: true,
          actionCount: 4,
          filtered: true,
        }),
      ),
    ).toMatch(/(^| )right-\[82px\]( |$)/);
  });
});

describe("an Activity row", () => {
  it("TEST_SCENARIO: the Agent's avatar sits beside its name", () => {
    const html = renderToStaticMarkup(
      createElement(SidebarActivityRow, {
        item: {
          id: "a-1:s-1",
          agent,
          session: {
            agentId: "a-1",
            sessionId: "s-1",
            title: "Fix the build",
            type: SessionType.Regular,
            mode: SessionMode.Chat,
          },
          at: "2026-10-20T08:00:00Z",
          working: false,
          unread: false,
          needsApproval: false,
        } as never,
        selected: false,
        now: new Date("2026-10-20T09:00:00Z"),
        conversation: undefined,
        onOpen: () => {},
      }),
    );
    expect(html).toMatch(/data-testid="agent-avatar"[^]*Reviewer/);
  });
});
