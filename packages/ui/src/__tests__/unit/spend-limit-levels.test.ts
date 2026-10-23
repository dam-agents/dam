// TEST_OVERVIEW: the spend level list each surface shows - Settings › Usage, Settings › Providers and an agent's Providers and Usage sections - assembled from one status. The four views must pick the same owner total and ceiling as the limits above a Connection or an agent, put each level in the group that renders it, count the calls each level shares, and mark exactly one level as the one that stops first.
import type { SpendLimitView, SpendStatus } from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  agentConnectionLevels,
  agentLevels,
  allAgentsConnectionLevels,
  totalLevels,
} from "../../modules/spend/lib/limit-levels.js";

const USD = 1_000_000;

function limit(
  id: string,
  scope: SpendLimitView["scope"],
  leftMicros: number,
  unit: SpendLimitView["unit"] = "usd",
): SpendLimitView {
  return {
    id,
    scope,
    unit,
    amountMicros: 10 * USD,
    extensions: 0,
    effectiveMicros: 10 * USD,
    spentMicros: 10 * USD - leftMicros,
    leftMicros,
    state: "ok",
  };
}

const connection = {
  id: "conn-1",
  name: "CurveBender",
  templateId: "curve-bender",
};
const otherConnection = {
  id: "conn-2",
  name: "Bob",
  templateId: "bob",
};

function status(limits: SpendLimitView[]): SpendStatus {
  return {
    day: "2026-10-23",
    resetsAt: "2026-10-24T00:00:00.000Z",
    limits,
    ceiling: {
      amountMicros: 20 * USD,
      spentMicros: 5 * USD,
      state: "ok",
      source: "operator",
    },
    spent: [{ unit: "usd", costMicros: 5 * USD, estimatedCalls: 2 }],
    spentByConnection: [
      {
        connectionId: "conn-1",
        unit: "usd",
        costMicros: 3 * USD,
        estimatedCalls: 1,
      },
      {
        connectionId: "conn-2",
        unit: "bobcoin",
        costMicros: 7 * USD,
        estimatedCalls: 1,
      },
    ],
    ownerSpentByConnection: [
      {
        connectionId: "conn-1",
        unit: "usd",
        costMicros: 3 * USD,
        estimatedCalls: 1,
      },
    ],
    binding: [],
  };
}

describe("the spend level views", () => {
  // TEST_SCENARIO: the total view owns the owner's own limit and counts only the ceiling above it, so it never lists the owner limit twice.
  it("lists only the ceiling above the owner's own total", () => {
    const view = totalLevels(
      status([limit("owner", { kind: "owner" }, 8 * USD)]),
    );
    expect(view.current?.kind).toBe("total");
    expect(view.others.map(({ level }) => level.kind)).toEqual(["ceiling"]);
    expect(view.others[0]?.level.stopsFirst).toBe(false);
    expect(view.others[0]?.level.mineMicros).toBe(null);
  });

  // TEST_SCENARIO: a dollar Connection counts the owner total and the ceiling above it, both in the every group, and the narrowest remaining level is the one that stops first.
  it("lists the owner total and the ceiling above an all-agents dollar Connection", () => {
    const view = allAgentsConnectionLevels(
      status([
        limit(
          "all",
          { kind: "owner-connection", connectionId: "conn-1" },
          9 * USD,
        ),
        limit("owner", { kind: "owner" }, 2 * USD),
      ]),
      connection,
      "usd",
    );
    expect(view.current?.kind).toBe("all-connection");
    expect(view.others.map(({ level, group }) => [level.kind, group])).toEqual([
      ["total", "every"],
      ["ceiling", "every"],
    ]);
    expect(view.others[0]?.level.mineMicros).toBe(null);
  });

  // TEST_SCENARIO: a subscription Connection counts nothing above it, because the owner total and the ceiling count dollars only.
  it("lists nothing above a Connection that is not billed in dollars", () => {
    const view = allAgentsConnectionLevels(
      status([
        limit(
          "all",
          { kind: "owner-connection", connectionId: "conn-2" },
          9 * USD,
        ),
      ]),
      otherConnection,
      "bobcoin",
    );
    expect(view.current?.kind).toBe("all-connection");
    expect(view.others).toEqual([]);
  });

  // TEST_SCENARIO: an agent's limit on a Connection lists the owner's limit for that Connection beside it, and the dollar total and ceiling count all of the agent's calls, not just this Connection's.
  it("counts an agent's own spend on the levels that see every call", () => {
    const view = agentConnectionLevels(
      status([
        limit(
          "own",
          {
            kind: "connection",
            agentId: "agent-1",
            connectionId: "conn-1",
          },
          9 * USD,
        ),
        limit(
          "all",
          { kind: "owner-connection", connectionId: "conn-1" },
          8 * USD,
        ),
        limit("agent", { kind: "agent", agentId: "agent-1" }, 7 * USD),
        limit("owner", { kind: "owner" }, 6 * USD),
      ]),
      "agent-1",
      connection,
      "usd",
    );
    expect(view.current?.kind).toBe("agent-connection");
    expect(view.others.map(({ level, group }) => [level.kind, group])).toEqual([
      ["all-connection", "provider"],
      ["agent", "every"],
      ["total", "every"],
      ["ceiling", "every"],
    ]);
    const mine = view.others.map(({ level }) => [level.kind, level.mineMicros]);
    expect(mine).toEqual([
      ["all-connection", 3 * USD],
      ["agent", null],
      ["total", 5 * USD],
      ["ceiling", 5 * USD],
    ]);
    expect(view.others.filter(({ level }) => level.stopsFirst)).toHaveLength(1);
    expect(view.others.find(({ level }) => level.stopsFirst)?.level.kind).toBe(
      "total",
    );
  });

  // TEST_SCENARIO: an agent's spending across providers marks the level that stops first among the every-group only, so a narrower provider limit never takes the mark.
  it("marks the first stop among the levels that count every call", () => {
    const view = agentLevels(
      status([
        limit("agent", { kind: "agent", agentId: "agent-1" }, 9 * USD),
        limit(
          "own",
          {
            kind: "connection",
            agentId: "agent-1",
            connectionId: "conn-1",
          },
          1 * USD,
        ),
        limit(
          "all",
          { kind: "owner-connection", connectionId: "conn-1" },
          2 * USD,
        ),
        limit("owner", { kind: "owner" }, 8 * USD),
      ]),
      "agent-1",
      [{ ...connection, unit: "usd" }],
    );
    expect(view.current?.kind).toBe("agent");
    expect(view.others.map(({ level, group }) => [level.kind, group])).toEqual([
      ["agent-connection", "provider"],
      ["all-connection", "provider"],
      ["total", "every"],
      ["ceiling", "every"],
    ]);
    expect(view.others.filter(({ level }) => level.stopsFirst)).toHaveLength(1);
    expect(view.others.find(({ level }) => level.stopsFirst)?.level.kind).toBe(
      "total",
    );
    const total = view.others.find(({ level }) => level.kind === "total");
    expect(total?.level.mineMicros).toBe(5 * USD);
  });
});
