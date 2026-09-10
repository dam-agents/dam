// TEST_OVERVIEW: running-vs-hibernated is derived from activity stamps rather than stored, so this decision function is the only thing standing between an idle agent and a node full of sandboxes — and between a working agent and being taken down under it.
import { describe, expect, it } from "vitest";
import {
  effectiveIdleTimeoutMs,
  shouldRun,
} from "../../modules/sandboxes/domain/hibernation.js";
import {
  ACTIVE_SESSION_KEY,
  EXPERIMENT_ACTIVE_KEY,
  LAST_ACTIVITY_KEY,
  STOP_REQUESTED_KEY,
} from "../../modules/agents/infrastructure/labels.js";

const NOW = new Date("2026-09-10T12:00:00Z");
const minutesAgo = (m: number) =>
  new Date(NOW.getTime() - m * 60_000).toISOString();
const TEN_MINUTES = 10 * 60_000;

describe("shouldRun", () => {
  it("keeps a recently active agent up and takes an idle one down", () => {
    expect(
      shouldRun({ [LAST_ACTIVITY_KEY]: minutesAgo(5) }, TEN_MINUTES, NOW),
    ).toBe(true);
    expect(
      shouldRun({ [LAST_ACTIVITY_KEY]: minutesAgo(11) }, TEN_MINUTES, NOW),
    ).toBe(false);
  });

  // TEST_SCENARIO: a stop is a user's explicit decision; no amount of activity may override it, or a stopped agent comes straight back up.
  it("obeys a stop request over everything else", () => {
    expect(
      shouldRun(
        {
          [STOP_REQUESTED_KEY]: NOW.toISOString(),
          [ACTIVE_SESSION_KEY]: "true",
          [LAST_ACTIVITY_KEY]: NOW.toISOString(),
        },
        TEN_MINUTES,
        NOW,
      ),
    ).toBe(false);
  });

  // TEST_SCENARIO: a long turn or a running experiment produces no activity stamps of its own; hibernating through one kills work in flight.
  it("keeps an agent up while a session or experiment is live, however stale the stamp", () => {
    for (const key of [ACTIVE_SESSION_KEY, EXPERIMENT_ACTIVE_KEY]) {
      expect(
        shouldRun(
          { [key]: "true", [LAST_ACTIVITY_KEY]: minutesAgo(600) },
          TEN_MINUTES,
          NOW,
        ),
      ).toBe(true);
    }
  });

  it("never hibernates when the timeout is zero or negative", () => {
    expect(shouldRun({ [LAST_ACTIVITY_KEY]: minutesAgo(600) }, 0, NOW)).toBe(true);
  });

  // TEST_SCENARIO: a clock problem must not read as idleness and take a working agent down.
  it("keeps an agent up when the stamp is missing or unparseable", () => {
    expect(shouldRun({}, TEN_MINUTES, NOW)).toBe(true);
    expect(
      shouldRun({ [LAST_ACTIVITY_KEY]: "not a date" }, TEN_MINUTES, NOW),
    ).toBe(true);
  });
});

describe("effectiveIdleTimeoutMs", () => {
  it("prefers the agent's own timeout and falls back to the node default", () => {
    expect(effectiveIdleTimeoutMs("30m", TEN_MINUTES)).toBe(30 * 60_000);
    expect(effectiveIdleTimeoutMs(undefined, TEN_MINUTES)).toBe(TEN_MINUTES);
    expect(effectiveIdleTimeoutMs("0s", TEN_MINUTES)).toBe(0);
  });

  it("falls back rather than hibernating instantly on an unreadable override", () => {
    expect(effectiveIdleTimeoutMs("soon", TEN_MINUTES)).toBe(TEN_MINUTES);
  });
});
