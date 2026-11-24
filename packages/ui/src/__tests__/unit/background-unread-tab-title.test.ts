// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useBackgroundUnread } from "../../modules/platform/hooks/use-background-unread.js";

/**
 * TEST_OVERVIEW: the browser tab is marked while it is in the background, and
 * only for something that arrived after it went there: a Session that came
 * back from working, a Session that is now unread, or an approval that started
 * waiting. What already was in that state stays quiet, and showing the tab
 * clears the mark.
 */

const feed = vi.hoisted(() => ({
  visible: true,
  attention: undefined as
    | {
        sessionId: string;
        activityAt: string;
        seenAt: string | null;
        working: boolean;
      }[]
    | undefined,
  approvals: undefined as { id: string; status: string }[] | undefined,
}));

vi.mock("../../modules/agents/hooks/use-page-visible.js", () => ({
  usePageVisible: () => feed.visible,
}));
vi.mock("../../modules/home/api/queries.js", () => ({
  useAttention: () => ({ data: feed.attention && { items: feed.attention } }),
}));
vi.mock("../../modules/approvals/api/queries.js", () => ({
  useApprovalsForOwner: () => ({ data: feed.approvals }),
}));

const seen = "2026-11-14T10:00:00Z";

function session(
  sessionId: string,
  { working, unread = false }: { working: boolean; unread?: boolean },
) {
  return {
    sessionId,
    activityAt: unread ? "2026-11-14T11:00:00Z" : seen,
    seenAt: seen,
    working,
  };
}

function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  let marked = false;
  function Probe() {
    marked = useBackgroundUnread();
    return null;
  }
  const render = () => act(() => root.render(createElement(Probe)));
  render();
  return {
    render,
    marked: () => marked,
    hide: () => {
      feed.visible = false;
      render();
    },
    show: () => {
      feed.visible = true;
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

describe("marking a background tab", () => {
  beforeEach(() => {
    feed.visible = true;
    feed.attention = [];
    feed.approvals = [];
  });

  // TEST_SCENARIO: the chat the user left was working when the tab went to the background; the runtime marks that Session seen, so only its return from working can tell.
  it("marks the tab when a working Session comes back while the tab is hidden", () => {
    feed.attention = [session("s1", { working: true })];
    const tab = mount();
    tab.hide();
    expect(tab.marked()).toBe(false);
    feed.attention = [session("s1", { working: false })];
    tab.render();
    expect(tab.marked()).toBe(true);
    tab.unmount();
  });

  // TEST_SCENARIO: a schedule Session is idle and seen when the tab goes to the background; it becomes unread while the tab is hidden, with no change in whether it works.
  // TEST_SCENARIO: the tab is hidden while the Session is idle; the prompt lands after the hide, so the record shows it idle again only when the turn ends.
  it("marks the tab when a turn starts and finishes while the tab is hidden", () => {
    feed.attention = [session("s1", { working: false })];
    const tab = mount();
    tab.hide();
    expect(tab.marked()).toBe(false);
    feed.attention = [session("s1", { working: true })];
    tab.render();
    expect(tab.marked()).toBe(false);
    feed.attention = [session("s1", { working: false })];
    tab.render();
    expect(tab.marked()).toBe(true);
    tab.unmount();
  });

  it("marks the tab when an idle Session becomes unread while the tab is hidden", () => {
    feed.attention = [session("s1", { working: false })];
    const tab = mount();
    tab.hide();
    expect(tab.marked()).toBe(false);
    feed.attention = [session("s1", { working: false, unread: true })];
    tab.render();
    expect(tab.marked()).toBe(true);
    tab.unmount();
  });

  // TEST_SCENARIO: a channel or schedule Session has been unread since yesterday; hiding the tab must not light it for that.
  it("stays quiet for what was already unread when the tab was hidden", () => {
    feed.attention = [session("old", { working: false, unread: true })];
    const tab = mount();
    tab.hide();
    tab.render();
    expect(tab.marked()).toBe(false);
    feed.attention = [
      session("old", { working: false, unread: true }),
      session("new", { working: false, unread: true }),
    ];
    tab.render();
    expect(tab.marked()).toBe(true);
    tab.unmount();
  });

  it("clears the mark when the tab is shown again", () => {
    const tab = mount();
    tab.hide();
    feed.attention = [session("s1", { working: false, unread: true })];
    tab.render();
    expect(tab.marked()).toBe(true);
    tab.show();
    expect(tab.marked()).toBe(false);
    tab.unmount();
  });

  it("marks the tab when an approval starts waiting while it is hidden", () => {
    const tab = mount();
    tab.hide();
    feed.approvals = [{ id: "approval-1", status: "pending" }];
    tab.render();
    expect(tab.marked()).toBe(true);
    tab.unmount();
  });

  // TEST_SCENARIO: the tab was hidden before the first read of approvals and sessions came back; loading them is not something that arrived.
  it("takes no mark from data that only arrived after the tab was hidden", () => {
    feed.attention = undefined;
    feed.approvals = undefined;
    const tab = mount();
    tab.hide();
    feed.attention = [session("s1", { working: false, unread: true })];
    feed.approvals = [{ id: "approval-1", status: "pending" }];
    tab.render();
    expect(tab.marked()).toBe(false);
    tab.unmount();
  });

  it("does not mark a tab in front of the user", () => {
    const tab = mount();
    feed.attention = [session("s1", { working: false, unread: true })];
    tab.render();
    expect(tab.marked()).toBe(false);
    tab.unmount();
  });
});
