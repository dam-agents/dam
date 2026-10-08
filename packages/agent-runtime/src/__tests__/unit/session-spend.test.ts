import { describe, expect, it } from "vitest";

import {
  spendBySession,
  spendTotal,
} from "../../modules/acp/domain/session-spend.js";

// TEST_OVERVIEW: what a harness reports each session cost, matched to the sessions the list shows and summed over a period.

const rows = [
  {
    sessionId: "task-a",
    cost: 0.1,
    startedAt: Date.parse("2026-10-02T09:00:00Z"),
  },
  {
    sessionId: "task-b",
    cost: 0.25,
    startedAt: Date.parse("2026-09-30T23:00:00Z"),
  },
  {
    sessionId: "task-c",
    cost: 0.05,
    startedAt: Date.parse("2026-10-31T23:59:00Z"),
  },
];

describe("session spend", () => {
  it("lists a pinned terminal conversation's spend under the terminal session", () => {
    const pins = (id: string) => (id === "task-b" ? "terminal-1" : undefined);
    const bySession = spendBySession(rows, "bobcoins", pins);

    expect(bySession.get("terminal-1")).toEqual({
      unit: "bobcoins",
      cost: 0.25,
    });
    expect(bySession.get("task-a")).toEqual({ unit: "bobcoins", cost: 0.1 });
    expect(bySession.has("task-b")).toBe(false);
  });

  it("sums the sessions that started inside the period", () => {
    const total = spendTotal(rows, "bobcoins", {
      from: Date.parse("2026-10-01T00:00:00Z"),
      to: Date.parse("2026-11-01T00:00:00Z"),
    });

    expect(total.sessions).toBe(2);
    expect(total.cost).toBeCloseTo(0.15);
    expect(total.unit).toBe("bobcoins");
  });
});
