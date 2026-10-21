// TEST_OVERVIEW: The classic sidebar marks unread work in blue with a text equivalent: on an unread Session row, and on the row of an Agent with an unread Session. An Activity row names its Agent with the Agent's avatar beside the name. An Agent row whose Sessions are closed keeps its unread marker and is not highlighted when its chat shows a Session.
import { SessionMode, SessionType } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AgentView, SessionView } from "../../types.js";

vi.stubGlobal("window", new EventTarget());

vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgentsList: () => [],
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
} as unknown as AgentView;

const agentRow = (props: { open: boolean; selected: boolean }) =>
  renderToStaticMarkup(
    createElement(SidebarAgentRow, {
      agent,
      current: false,
      unread: true,
      orderReady: true,
      onMove: () => {},
      onStep: () => {},
      onSelect: () => {},
      actions: null,
      actionCount: 2,
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
    expect(agentRow({ open: true, selected: true })).toContain("pr-[60px]");
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
