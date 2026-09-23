// TEST_OVERVIEW: which agent-list refreshes tell the user that an agent crashed. The termination cause is visible only while the restarted agent is not ready yet, and a refresh usually misses that window. The restart count stays on the agent, so a rising count must raise one notice, naming memory when the cause was OutOfMemory. A count seen on first load, a count that falls when the pod is replaced or the agent hibernates, and a crash already announced from its termination cause raise nothing.
import { describe, expect, it } from "vitest";

import {
  type CrashMark,
  nextCrashNotices,
} from "../../modules/agents/lib/crash-notices.js";

type Watched = Parameters<typeof nextCrashNotices>[1][number];

function agent(overrides: Partial<Watched> = {}): Watched {
  return {
    id: "a1",
    name: "Scout",
    state: "running",
    podRestarts: 0,
    ...overrides,
  };
}

function replay(...snapshots: Watched[][]) {
  let marks: ReadonlyMap<string, CrashMark> = new Map();
  const messages: string[][] = [];
  for (const agents of snapshots) {
    const next = nextCrashNotices(marks, agents);
    marks = next.marks;
    messages.push(next.toasts.map((t) => t.message));
  }
  return messages;
}

describe("nextCrashNotices", () => {
  // TEST_SCENARIO: the agent was killed for memory and is running again before the list refreshed. Only the restart count shows it, and the user must learn it was memory, once.
  it("names memory once when the restart count rises after an OOM kill", () => {
    const oom = agent({ podRestarts: 1, podRestartReason: "OutOfMemory" });
    expect(replay([agent()], [oom], [oom])).toEqual([
      [],
      [
        "Scout ran out of memory and restarted — give it a larger size in its settings",
      ],
      [],
    ]);
  });

  // TEST_SCENARIO: the cause of a restart is one the controller does not name. The user must still learn the agent restarted.
  it("reports an unnamed restart cause as a crash", () => {
    expect(
      replay(
        [agent({ podRestarts: 2 })],
        [agent({ podRestarts: 3, podRestartReason: "ContainerTerminated" })],
      ),
    ).toEqual([[], ["Scout crashed and restarted"]]);
  });

  // TEST_SCENARIO: the page opens on an agent that restarted long ago. That old count is history, not news.
  it("stays quiet about a count seen on first load", () => {
    expect(
      replay([agent({ podRestarts: 4, podRestartReason: "OutOfMemory" })]),
    ).toEqual([[]]);
  });

  // TEST_SCENARIO: the count falls to zero when the pod is replaced or the agent hibernates, then rises from there. Only the rise is a crash.
  it("treats a reset count as a new baseline", () => {
    expect(
      replay(
        [agent({ podRestarts: 2 })],
        [agent({ state: "hibernated", podRestarts: 0 })],
        [agent({ podRestarts: 1, podRestartReason: "OutOfMemory" })],
      ),
    ).toEqual([
      [],
      [],
      [
        "Scout ran out of memory and restarted — give it a larger size in its settings",
      ],
    ]);
  });

  // TEST_SCENARIO: a refresh caught the not-ready window and the termination cause was announced. The restart count that follows is the same crash and must not raise a second notice.
  it("does not announce a crash twice", () => {
    expect(
      replay(
        [agent()],
        [
          agent({
            state: "starting",
            podTerminationReason: "out of memory (OOMKilled)",
          }),
        ],
        [agent({ podRestarts: 1, podRestartReason: "OutOfMemory" })],
        [agent({ podRestarts: 2, podRestartReason: "OutOfMemory" })],
      ),
    ).toEqual([
      [],
      ["Scout crashed — out of memory (OOMKilled)"],
      [],
      [
        "Scout ran out of memory and restarted — give it a larger size in its settings",
      ],
    ]);
  });

  // TEST_SCENARIO: an agent with too little memory is killed on every start and never gets ready, so its termination cause stays the same and is never cleared. The cause is visible at a restart count, and the container that replaces it adds one; that step is the crash already announced. Every rise after it is a new kill and must still reach the user.
  it("keeps announcing an agent that is killed again before it is ever ready", () => {
    const killed = (podRestarts: number) =>
      agent({
        state: "starting",
        podRestarts,
        podRestartReason: podRestarts > 0 ? "OutOfMemory" : undefined,
        podTerminationReason: "out of memory (OOMKilled)",
      });
    const again =
      "Scout ran out of memory and restarted — give it a larger size in its settings";
    expect(
      replay([agent()], [killed(0)], [killed(1)], [killed(2)], [killed(3)]),
    ).toEqual([
      [],
      ["Scout crashed — out of memory (OOMKilled)"],
      [],
      [again],
      [again],
    ]);
  });
});
