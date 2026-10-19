// TEST_OVERVIEW: The new layout's sidebar is one tree of Agents. An Agent row opens and closes its Session list, a "New session" row ends each open list and a "New agent" row ends the tree, a pinned Session moves into the Pinned section at the top and leaves its Agent's list, and each Session row carries an activity dot whose state has a text label and whose spin stops under reduced motion.
import { SessionMode, SessionType, type SessionView } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ActivityDot } from "../../modules/platform/components/sidebar-v2/activity-dot.js";
import { AddRow } from "../../modules/platform/components/sidebar-v2/add-row.js";
import {
  activityTone,
  awaitsApproval,
  sessionContext,
  splitPinned,
  toggleExpanded,
} from "../../modules/platform/lib/sidebar-tree.js";

describe("sidebar tree", () => {
  // TEST_SCENARIO: opening one Agent leaves the others as they are, and a second toggle closes it again.
  it("opens and closes one Agent at a time", () => {
    const one = toggleExpanded(new Set(["a"]), "b");
    expect([...one]).toEqual(["a", "b"]);
    expect([...toggleExpanded(one, "a")]).toEqual(["b"]);
  });

  // TEST_SCENARIO: a pin moves a Session into the Pinned list in activity order and out of the rest; unpinning puts it back in its old place.
  it("moves pinned Sessions above the rest and back", () => {
    const rows = ["s1", "s2", "s3", "s4"];
    const [pinned, rest] = splitPinned(
      rows,
      (id) => id === "s3" || id === "s1",
    );
    expect(pinned).toEqual(["s1", "s3"]);
    expect(rest).toEqual(["s2", "s4"]);
    expect(splitPinned(rows, (id) => id === "s1")[1]).toEqual([
      "s2",
      "s3",
      "s4",
    ]);
  });

  // TEST_SCENARIO: an approval outranks work, work outranks unread, and a quiet Session is idle.
  it.each([
    [{ working: true, needsApproval: true, unread: true }, "approval"],
    [{ working: true, needsApproval: false, unread: true }, "working"],
    [{ working: false, needsApproval: false, unread: true }, "unread"],
    [{ working: false, needsApproval: false, unread: false }, "idle"],
  ] as const)("picks the dot for %o", (state, tone) => {
    expect(activityTone(state)).toBe(tone);
  });

  // TEST_SCENARIO: a pinned row reads its approval tone from the owner's approvals: only a pending approval of that Agent's Session counts.
  it("finds a pending approval for one Session", () => {
    const approvals = [
      { status: "approved", agentId: "a", sessionId: "s1" },
      { status: "pending", agentId: "b", sessionId: "s1" },
      { status: "pending", agentId: "a", sessionId: null },
    ];
    expect(awaitsApproval(approvals, "a", "s1")).toBe(false);
    expect(
      awaitsApproval(
        [...approvals, { status: "pending", agentId: "a", sessionId: "s1" }],
        "a",
        "s1",
      ),
    ).toBe(true);
  });

  // TEST_SCENARIO: only a working Session's dot spins, it stops spinning under prefers-reduced-motion, and every state names itself to assistive technology.
  it("draws the dot with a text label", () => {
    const working = renderToStaticMarkup(
      createElement(ActivityDot, { tone: "working" }),
    );
    expect(working).toContain('aria-label="Working"');
    expect(working).toContain("animate-spin");
    expect(working).toContain("motion-reduce:animate-none");
    const idle = renderToStaticMarkup(
      createElement(ActivityDot, { tone: "idle" }),
    );
    expect(idle).toContain('role="img"');
    expect(idle).toContain('aria-label="Idle"');
    expect(idle).not.toContain("animate-spin");
  });

  // TEST_SCENARIO: the line under a Session title names the harness, the model and where the Session came from.
  it("names harness, model and source", () => {
    const session: SessionView = {
      sessionId: "s1",
      agentId: "a",
      type: SessionType.ChannelSlack,
      mode: SessionMode.Chat,
      createdAt: "2026-10-19T00:00:00Z",
      harness: "claude-code",
      model: "claude-opus-4-7",
    };
    expect(sessionContext(session, "#ops")).toBe(
      "Claude · Opus 4.7 · Slack #ops",
    );
    expect(
      sessionContext({
        ...session,
        type: SessionType.Regular,
        harness: null,
        model: null,
      }),
    ).toBe("Chat");
    expect(sessionContext({ ...session, mode: SessionMode.Terminal })).toBe(
      "Claude · Opus 4.7 · Terminal",
    );
  });
});

describe("sidebar tree add rows", () => {
  // TEST_SCENARIO: the "New session" row closing an Agent's list and the "New agent" row closing the Agent list are real buttons a keyboard reaches, named by their text, with the plus icon hidden from assistive technology.
  it.each([
    ["New session", "sidebar-new-session-row"],
    ["New agent", "sidebar-new-agent-row"],
  ])("draws %s as a button", (label, testId) => {
    const html = renderToStaticMarkup(
      createElement(AddRow, { label, testId, onClick: () => {} }),
    );
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain(`data-testid="${testId}"`);
    expect(html).toContain(`>${label}</span>`);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('disabled=""');
  });

  // TEST_SCENARIO: while a new Agent cannot be created yet, its row is disabled rather than silently doing nothing.
  it("disables the row when creating is not ready", () => {
    const html = renderToStaticMarkup(
      createElement(AddRow, {
        label: "New agent",
        testId: "sidebar-new-agent-row",
        disabled: true,
        onClick: () => {},
      }),
    );
    expect(html).toContain('disabled=""');
  });
});
