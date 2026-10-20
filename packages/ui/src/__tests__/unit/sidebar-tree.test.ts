// TEST_OVERVIEW: The new layout's sidebar is one tree of Agents. An Agent row opens and closes its Session list (the open Agent opens on its own, and only that one), a change in the attention record names the Agents whose lists must refresh, a "New session" row ends each open list and a "New agent" row ends the tree, a pinned Session moves into the Pinned section at the top and leaves its Agent's list, a pin the bounded feed does not hold is read from its Agent's own list, a closed Agent shows a pending approval before unread, and each Session row carries an activity dot whose state has a text label and whose spin stops under reduced motion.
import { AddAlt, AddComment } from "@carbon/icons-react";
import { SessionMode, SessionType, type SessionView } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ActivityDot,
  AgentCue,
} from "../../modules/platform/components/sidebar-v2/activity-dot.js";
import { AddRow } from "../../modules/platform/components/sidebar-v2/add-row.js";
import {
  activityTone,
  agentsWithUnlistedPins,
  awaitsApproval,
  changedAgents,
  isExpanded,
  recordSignatures,
  sessionContext,
  splitPinned,
  toggleExpanded,
} from "../../modules/platform/lib/sidebar-tree.js";

describe("sidebar tree", () => {
  // TEST_SCENARIO: opening one Agent leaves the others as they are, and a second toggle closes it again.
  it("opens and closes one Agent at a time", () => {
    const one = toggleExpanded(toggleExpanded(new Map(), "a", null), "b", null);
    expect(isExpanded(one, "a", null)).toBe(true);
    expect(isExpanded(one, "b", null)).toBe(true);
    const two = toggleExpanded(one, "a", null);
    expect(isExpanded(two, "a", null)).toBe(false);
    expect(isExpanded(two, "b", null)).toBe(true);
  });

  // TEST_SCENARIO: the Agent open in the page opens on its own, and moving to another Agent closes it again unless the user opened it; the user can still close the open Agent. Visiting many Agents keeps one list open, not all of them.
  it("opens only the Agent open in the page by itself", () => {
    const none = new Map<string, boolean>();
    expect(isExpanded(none, "a", "a")).toBe(true);
    expect(isExpanded(none, "a", "b")).toBe(false);
    const closed = toggleExpanded(none, "a", "a");
    expect(isExpanded(closed, "a", "a")).toBe(false);
  });

  // TEST_SCENARIO: a Session that starts, finishes, is renamed, is read, appears or goes away changes its Agent's record signature, so that Agent's own list refreshes; an Agent whose rows did not change does not refetch.
  it("names the Agents whose record changed", () => {
    const row = (
      agentId: string,
      sessionId: string,
      at: string,
      working = false,
    ) => ({
      session: { agentId, sessionId, title: "t", seenAt: null },
      at,
      working,
    });
    const before = recordSignatures([row("a", "s1", "1"), row("b", "s2", "1")]);
    expect(changedAgents(before, before)).toEqual([]);
    expect(
      changedAgents(
        before,
        recordSignatures([row("a", "s1", "1", true), row("b", "s2", "1")]),
      ),
    ).toEqual(["a"]);
    expect(
      changedAgents(before, recordSignatures([row("b", "s2", "1")])),
    ).toEqual(["a"]);
    expect(
      changedAgents(
        before,
        recordSignatures([
          row("a", "s1", "1"),
          row("b", "s2", "1"),
          row("c", "s3", "1"),
        ]),
      ),
    ).toEqual(["c"]);
  });

  // TEST_SCENARIO: a pin the bounded attention feed does not hold, for example one on the second page of its Agent's list, sends that Agent's own list to the Pinned section; pins the feed holds need nothing more, and an Agent with no such pin is not read.
  it("finds the Agents whose pins the feed lacks", () => {
    const pins = new Set(["a:old", "b:new", "c:gone"]);
    expect(
      agentsWithUnlistedPins(pins, new Set(["b:new"]), ["a", "b", "c", "d"]),
    ).toEqual(["a", "c"]);
    expect(agentsWithUnlistedPins(pins, pins, ["a", "b", "c"])).toEqual([]);
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

  // TEST_SCENARIO: an approval outranks work, work outranks background work, background work outranks unread, unread outranks a draft, and only a Session with none of them is idle.
  it.each([
    [{ working: true, needsApproval: true, unread: true }, "approval"],
    [{ working: true, needsApproval: false, unread: true }, "working"],
    [{ working: false, needsApproval: false, unread: true }, "unread"],
    [{ working: false, needsApproval: false, unread: false }, "idle"],
    [
      {
        working: false,
        needsApproval: false,
        unread: true,
        backgroundWork: [{}],
      },
      "background",
    ],
    [
      { working: false, needsApproval: false, unread: true, draft: true },
      "unread",
    ],
    [
      { working: false, needsApproval: false, unread: false, draft: true },
      "draft",
    ],
  ] as const)("picks the dot for %o", (state, tone) => {
    expect(activityTone(state)).toBe(tone);
  });

  // TEST_SCENARIO: a pinned row reads its approval tone from the owner's approvals: only a pending approval of that Agent's Session counts.
  it("finds a pending approval for one Session", () => {
    const approvals = [
      { status: "resolved", agentId: "a", sessionId: "s1" },
      { status: "pending", agentId: "b", sessionId: "s1" },
      { status: "pending", agentId: "a", sessionId: null },
    ] as const;
    expect(awaitsApproval(approvals, "a", "s1")).toBe(false);
    expect(
      awaitsApproval(
        [...approvals, { status: "pending", agentId: "a", sessionId: "s1" }],
        "a",
        "s1",
      ),
    ).toBe(true);
  });

  // TEST_SCENARIO: a closed Agent whose read Session waits for an approval shows the approval cue before unread, with a text equivalent; an Agent with only resolved approvals shows none.
  it("cues a closed Agent's pending approval", () => {
    expect(
      awaitsApproval(
        [{ status: "pending", agentId: "a", sessionId: "s1" }],
        "a",
      ),
    ).toBe(true);
    expect(
      awaitsApproval(
        [{ status: "resolved", agentId: "a", sessionId: "s1" }],
        "a",
      ),
    ).toBe(false);
    const html = renderToStaticMarkup(
      createElement(AgentCue, { tone: "approval" }),
    );
    expect(html).toContain('data-tone="approval"');
    expect(html).toContain("bg-warning");
    expect(html).toContain(
      '<span class="sr-only">(needs your approval)</span>',
    );
  });

  // TEST_SCENARIO: background work after the foreground run ends and an unsent draft each keep a visible mark with their own label, never "Idle".
  it("marks background work and drafts", () => {
    const background = renderToStaticMarkup(
      createElement(ActivityDot, {
        tone: "background",
        label: "Running: npm test",
      }),
    );
    expect(background).toContain('aria-label="Running: npm test"');
    expect(background).toContain("border-success");
    const draft = renderToStaticMarkup(
      createElement(ActivityDot, { tone: "draft" }),
    );
    expect(draft).toContain('aria-label="Has a draft"');
    expect(draft).toContain("<svg");
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
    ["New session", "sidebar-new-session-row", AddComment],
    ["New agent", "sidebar-new-agent-row", AddAlt],
  ] as const)("draws %s as a button", (label, testId, icon) => {
    const html = renderToStaticMarkup(
      createElement(AddRow, { icon, label, testId, onClick: () => {} }),
    );
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain(`data-testid="${testId}"`);
    expect(html).toContain(`>${label}</span>`);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('disabled=""');
  });

  // TEST_SCENARIO: every open Agent ends with its own New session row, so each row's accessible name names its Agent while the visible text stays short.
  it("names the Agent in a New session row", () => {
    const html = renderToStaticMarkup(
      createElement(AddRow, {
        icon: AddComment,
        label: "New session",
        ariaLabel: "New session with dam",
        testId: "sidebar-new-session-row",
        onClick: () => {},
      }),
    );
    expect(html).toContain('aria-label="New session with dam"');
    expect(html).toContain(">New session</span>");
  });

  // TEST_SCENARIO: while a new Agent cannot be created yet, its row is disabled rather than silently doing nothing.
  it("disables the row when creating is not ready", () => {
    const html = renderToStaticMarkup(
      createElement(AddRow, {
        icon: AddAlt,
        label: "New agent",
        testId: "sidebar-new-agent-row",
        disabled: true,
        onClick: () => {},
      }),
    );
    expect(html).toContain('disabled=""');
  });
});
