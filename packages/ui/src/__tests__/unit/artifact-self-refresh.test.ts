import { describe, expect, test } from "vitest";

import {
  AUTO_REQUEST_IDLE_LIMIT_MS,
  AUTO_REQUEST_MIN_GAP_MS,
  holdReason,
  type SelfRefreshClock,
  type SelfRefreshHold,
  selfRefreshHold,
  selfRefreshLabel,
} from "../../modules/artifacts/lib/self-refresh.js";
import { askedByAPerson } from "../../modules/artifacts/lib/user-gesture.js";

const NOW = 1_700_000_000_000;

function clock(over: Partial<SelfRefreshClock> = {}): SelfRefreshClock {
  return {
    now: NOW,
    lastAutoAt: null,
    lastActivityAt: NOW,
    hidden: false,
    paused: false,
    inFlight: false,
    ...over,
  };
}

// TEST_OVERVIEW: A page's refresh timer was written by the agent, not by the person watching, so the app paces automatic Artifact Requests before they become turns the owner pays for. Which kind a request is comes only from the browser's own user-activation signal: a click inside the frame lifts every window above it, a timer lifts nothing. Once a request is automatic, four rules can hold it back — the person paused it, the tab is in the background, nobody has touched the page for 30 minutes, or its last request is still with the agent — plus a floor of 30 seconds between two of them. The server's caps of 60 an hour and one in flight stay the backstop; these rules keep the everyday path away from them. Every hold has its own wording, because that wording is both what the chip says and what the page is told.

describe("telling a person's click from the page's timer", () => {
  test("transient activation means a person asked", () => {
    expect(askedByAPerson({ userActivation: { isActive: true } })).toBe(true);
  });

  // TEST_SCENARIO: A setInterval in the page produces no activation. That is the whole basis for `trigger: "auto"`, and so for keeping timers out of the activity log.
  test("no activation means the page asked on its own", () => {
    expect(askedByAPerson({ userActivation: { isActive: false } })).toBe(false);
  });

  // TEST_SCENARIO: `navigator.userActivation` is Baseline, but a browser without it must not lose its buttons. A timer let through is bounded by the server's caps; a refused click is not recoverable.
  test("a browser that cannot report activation is read as a person", () => {
    expect(askedByAPerson({})).toBe(true);
  });
});

describe("pacing the page's own requests", () => {
  test("nothing holds back the first automatic request", () => {
    expect(selfRefreshHold(clock())).toBeNull();
  });

  test("a pause the person asked for holds everything", () => {
    expect(selfRefreshHold(clock({ paused: true }))).toBe("paused");
  });

  // TEST_SCENARIO: A forgotten tab is the case this slice exists for: nobody is reading the page, and the agent is being held awake for it.
  test("a background tab holds automatic requests", () => {
    expect(selfRefreshHold(clock({ hidden: true }))).toBe("hidden");
  });

  test("30 minutes with nobody touching the page stops it", () => {
    expect(
      selfRefreshHold(
        clock({ lastActivityAt: NOW - AUTO_REQUEST_IDLE_LIMIT_MS }),
      ),
    ).toBe("idle");
    expect(
      selfRefreshHold(
        clock({ lastActivityAt: NOW - AUTO_REQUEST_IDLE_LIMIT_MS + 1 }),
      ),
    ).toBeNull();
  });

  // TEST_SCENARIO: A turn can run for minutes while the page keeps asking every 30 seconds. Those extra asks are ordinary, not a failure, so they are held here rather than sent for the server to refuse as busy.
  test("a request still with the agent holds the next one", () => {
    expect(selfRefreshHold(clock({ inFlight: true }))).toBe("in_flight");
  });

  test("two automatic requests inside 30 seconds are not both let through", () => {
    expect(
      selfRefreshHold(clock({ lastAutoAt: NOW - AUTO_REQUEST_MIN_GAP_MS + 1 })),
    ).toBe("too_soon");
    expect(
      selfRefreshHold(clock({ lastAutoAt: NOW - AUTO_REQUEST_MIN_GAP_MS })),
    ).toBeNull();
  });

  // TEST_SCENARIO: More than one rule can hold at once. The person reads one sentence, so it has to be the one they can act on: their own pause before the tab's state, and both before a gap that is only seconds long.
  test("the reason a person can act on wins", () => {
    const everything = clock({
      paused: true,
      hidden: true,
      inFlight: true,
      lastActivityAt: NOW - AUTO_REQUEST_IDLE_LIMIT_MS,
      lastAutoAt: NOW,
    });
    expect(selfRefreshHold(everything)).toBe("paused");
    expect(selfRefreshHold({ ...everything, paused: false })).toBe("hidden");
    expect(
      selfRefreshHold({ ...everything, paused: false, hidden: false }),
    ).toBe("idle");
  });
});

describe("saying what the page is doing", () => {
  const holds = [
    "paused",
    "hidden",
    "idle",
    "in_flight",
    "too_soon",
  ] as const satisfies readonly SelfRefreshHold[];

  test("refreshing and every hold have their own wording", () => {
    const labels = [null, ...holds].map(selfRefreshLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });

  // TEST_SCENARIO: An idle stop is the one hold nothing will lift on its own, so its wording has to name both the limit and the way back.
  test("the idle stop says how long and what to do", () => {
    expect(selfRefreshLabel("idle")).toContain("30 minutes");
    expect(selfRefreshLabel("idle")).toContain("Click");
  });

  // TEST_SCENARIO: The page renders the reason itself, and only the pinned set of reasons exists. A hold has to arrive as one of them.
  test("a hold reaches the page as a reason it already knows", () => {
    expect(holdReason("in_flight")).toBe("busy");
    for (const hold of holds.filter((h) => h !== "in_flight"))
      expect(holdReason(hold)).toBe("rate_limited");
  });
});
