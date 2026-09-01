import { SessionMode, SessionType, type SessionView } from "api-server-api";
import { describe, expect, test } from "vitest";

import { runTimeLabel } from "../../modules/sessions/lib/run-time.js";

function session(over: Partial<SessionView>): SessionView {
  return {
    sessionId: "s1",
    agentId: "a1",
    type: SessionType.ScheduleCron,
    mode: SessionMode.Chat,
    createdAt: "2026-01-01T00:00:00Z",
    scheduleId: null,
    experimentId: null,
    threadTs: null,
    title: null,
    updatedAt: null,
    running: false,
    seenAt: null,
    ...over,
  };
}

describe("runTimeLabel", () => {
  test("sums the fires and counts them only past the first", () => {
    expect(runTimeLabel(session({ runTotalMs: 252_000, runCount: 1 }))).toBe(
      "Ran 4m 12s",
    );
    expect(runTimeLabel(session({ runTotalMs: 1_930_000, runCount: 8 }))).toBe(
      "Ran 32m 10s across 8 runs",
    );
  });

  test("scopes the total to the finished fires while one is running", () => {
    expect(
      runTimeLabel(
        session({ runStartedAt: "2026-01-01T00:00:00Z", runCount: 0 }),
      ),
    ).toBe("Running now");
    expect(
      runTimeLabel(
        session({
          runStartedAt: "2026-01-01T00:00:00Z",
          runTotalMs: 252_000,
          runCount: 1,
        }),
      ),
    ).toBe("Running now · 1 run finished, 4m 12s");
  });

  test("says nothing before the first fire finishes", () => {
    expect(runTimeLabel(session({}))).toBeNull();
  });
});
