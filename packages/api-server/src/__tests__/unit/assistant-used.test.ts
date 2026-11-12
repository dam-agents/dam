// TEST_OVERVIEW: the assistant's used mark, decided where every Session report
// TEST_OVERVIEW: passes: a report counts as a use only for a Session that began
// TEST_OVERVIEW: after the person's last onboarding reset, so the Sessions a
// TEST_OVERVIEW: runtime re-reports when it boots cannot take the greeting away
// TEST_OVERVIEW: again. The use is announced once, so every tab with the owner
// TEST_OVERVIEW: signed in learns it.
import type { SessionDirectoryEntry } from "agent-runtime-api";
import { describe, expect, it, vi } from "vitest";

import { EventType, events$ } from "../../events.js";
import type { AssistantUsage } from "../../modules/assistants/infrastructure/assistants-repository.js";
import {
  countsAsUse,
  createAssistantUsageMarker,
  newestSessionAt,
} from "../../modules/assistants/services/usage-marker.js";

const BEFORE = new Date("2026-11-09T10:00:00Z");
const RESET = new Date("2026-11-09T12:00:00Z");
const AFTER = new Date("2026-11-09T13:00:00Z");

function session(createdAt: Date): SessionDirectoryEntry {
  return {
    sessionId: `s-${createdAt.toISOString()}`,
    mode: "chat",
    type: "regular",
    createdAt: createdAt.toISOString(),
  } as SessionDirectoryEntry;
}

function world(usage: AssistantUsage | null) {
  const markUsed = vi.fn(async () => {});
  const marker = createAssistantUsageMarker({
    repo: { usageOf: async () => usage, markUsed },
  });
  const announced: string[] = [];
  const subscription = events$().subscribe((event) => {
    if (event.type === EventType.AssistantUsed) announced.push(event.agentId);
  });
  return {
    markUsed,
    marker,
    announced,
    stop: () => subscription.unsubscribe(),
  };
}

describe("whether a report counts as a use", () => {
  // TEST_SCENARIO: an assistant nobody has used and never reset is used by any Session, and one that was already used stays used.
  it("counts a first Session, and nothing after the mark", () => {
    expect(countsAsUse({ used: false, resetAt: null }, BEFORE)).toBe(true);
    expect(countsAsUse({ used: true, resetAt: null }, AFTER)).toBe(false);
  });

  // TEST_SCENARIO: after a reset only a Session that began later counts, so the Sessions a runtime boots with — created before the reset — leave the person a first-timer.
  it("ignores Sessions that began before the last reset", () => {
    expect(countsAsUse({ used: false, resetAt: RESET }, BEFORE)).toBe(false);
    expect(countsAsUse({ used: false, resetAt: RESET }, AFTER)).toBe(true);
  });
});

describe("the newest Session in a report", () => {
  // TEST_SCENARIO: a report carrying the whole history is dated by its newest Session, and an empty one has none.
  it("is the latest of the report's Sessions", () => {
    expect(newestSessionAt([session(BEFORE), session(AFTER)])).toEqual(AFTER);
    expect(newestSessionAt([])).toBeNull();
  });
});

describe("marking the assistant used", () => {
  // TEST_SCENARIO: a Session started after the reset marks the assistant used and announces it to the owner's tabs.
  it("marks a new Session used and announces it", async () => {
    const w = world({ owner: "alice", used: false, resetAt: RESET });
    await w.marker("agent-a", [session(AFTER)]);
    expect(w.markUsed).toHaveBeenCalledWith("agent-a");
    expect(w.announced).toEqual(["agent-a"]);
    w.stop();
  });

  // TEST_SCENARIO: a runtime that boots and re-reports the Sessions it already had is not a new use: nothing is written and nothing is announced.
  it("ignores a re-report of Sessions from before the reset", async () => {
    const w = world({ owner: "alice", used: false, resetAt: RESET });
    await w.marker("agent-a", [session(BEFORE)]);
    expect(w.markUsed).not.toHaveBeenCalled();
    expect(w.announced).toEqual([]);
    w.stop();
  });

  // TEST_SCENARIO: a report for an Agent that is nobody's assistant marks nothing.
  it("ignores an agent that is not the assistant", async () => {
    const w = world(null);
    await w.marker("agent-other", [session(AFTER)]);
    expect(w.markUsed).not.toHaveBeenCalled();
    expect(w.announced).toEqual([]);
    w.stop();
  });
});
