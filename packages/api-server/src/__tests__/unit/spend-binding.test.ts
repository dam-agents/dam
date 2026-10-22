// TEST_OVERVIEW: for one agent, the limit that stops its calls first is the one with the least left today among those that count the calls: per Connection, and for its dollar spend across Connections. Dollar-only limits never count a subscription or Bob Connection, and a tie names the limit set closest to the agent.
import type {
  SpendCeilingView,
  SpendLimitScope,
  SpendLimitView,
} from "api-server-api";
import { describe, expect, it } from "vitest";

import { bindingOf } from "../../modules/spend/domain/binding.js";
import type { SpendUnit } from "../../modules/spend/domain/units.js";

const AGENT = "agent-a";
const KEY = "conn-key";
const PLAN = "conn-plan";
const usd = (dollars: number) => Math.round(dollars * 1_000_000);

function limit(
  id: string,
  scope: SpendLimitScope,
  unit: SpendUnit,
  amount: number,
  spent: number,
): SpendLimitView {
  return {
    id,
    scope,
    unit,
    amountMicros: usd(amount),
    extensions: 0,
    effectiveMicros: usd(amount),
    spentMicros: usd(spent),
    leftMicros: Math.max(0, usd(amount) - usd(spent)),
    state: "ok",
  };
}

const ceiling = (amount: number, spent: number): SpendCeilingView => ({
  amountMicros: usd(amount),
  spentMicros: usd(spent),
  state: "ok",
  source: "default",
});

const connections = [
  { connectionId: KEY, name: "Anthropic", unit: "usd" as const },
  {
    connectionId: PLAN,
    name: "Claude subscription",
    unit: "usd_list" as const,
  },
];

describe("bindingOf", () => {
  // TEST_SCENARIO: the plan's example — an agent limit of $5 with $1.10 spent and an all-agents limit of $20 with $19.50 spent on the key: the all-agents limit stops first with $0.50 left, and the agent limit is listed as the other.
  it("names the all-agents provider limit when it has less left", () => {
    const rows = bindingOf({
      agentId: AGENT,
      limits: [
        limit(
          "l-agent",
          { kind: "connection", agentId: AGENT, connectionId: KEY },
          "usd",
          5,
          1.1,
        ),
        limit(
          "l-all",
          { kind: "owner-connection", connectionId: KEY },
          "usd",
          20,
          19.5,
        ),
      ],
      ceiling: null,
      connections,
    });
    const key = rows.find((row) => row.connectionId === KEY);
    expect(key?.stopsFirst).toEqual({
      kind: "owner-connection",
      limitId: "l-all",
      leftMicros: usd(0.5),
    });
    expect(key?.others.map((other) => other.kind)).toEqual(["connection"]);
  });

  // TEST_SCENARIO: the agent limit, the own limit and the ceiling count dollars only, so a subscription Connection's row is decided by its own limits alone even when a dollar limit has less left.
  it("keeps dollar-only limits off a subscription Connection", () => {
    const rows = bindingOf({
      agentId: AGENT,
      limits: [
        limit(
          "l-plan",
          { kind: "owner-connection", connectionId: PLAN },
          "usd_list",
          100,
          10,
        ),
        limit("l-own", { kind: "owner" }, "usd", 1, 0.9),
        limit("l-agent", { kind: "agent", agentId: AGENT }, "usd", 1, 0.9),
      ],
      ceiling: ceiling(1, 0.95),
      connections,
    });
    const plan = rows.find((row) => row.connectionId === PLAN);
    expect(plan?.unit).toBe("usd_list");
    expect(plan?.stopsFirst.kind).toBe("owner-connection");
    expect(plan?.others).toEqual([]);
  });

  // TEST_SCENARIO: on a dollar Connection the ceiling and the own limit compete with the Connection's limits, and the across-Connections row compares only the agent limit, the own limit and the ceiling.
  it("lets the ceiling stop a dollar Connection and the agent's dollars", () => {
    const rows = bindingOf({
      agentId: AGENT,
      limits: [
        limit(
          "l-all",
          { kind: "owner-connection", connectionId: KEY },
          "usd",
          20,
          5,
        ),
        limit("l-own", { kind: "owner" }, "usd", 40, 30),
      ],
      ceiling: ceiling(50, 49),
      connections,
    });
    expect(rows.find((row) => row.connectionId === KEY)?.stopsFirst).toEqual({
      kind: "ceiling",
      limitId: null,
      leftMicros: usd(1),
    });
    const across = rows.find((row) => row.connectionId === null);
    expect(across?.stopsFirst.kind).toBe("ceiling");
    expect(across?.others.map((other) => other.kind)).toEqual(["owner"]);
  });

  // TEST_SCENARIO: when two limits have the same amount left, the one set closest to the agent is named, so a tie between the agent's provider limit and the all-agents one names the agent's.
  it("breaks a tie towards the narrower limit", () => {
    const rows = bindingOf({
      agentId: AGENT,
      limits: [
        limit(
          "l-all",
          { kind: "owner-connection", connectionId: KEY },
          "usd",
          3,
          1,
        ),
        limit(
          "l-agent",
          { kind: "connection", agentId: AGENT, connectionId: KEY },
          "usd",
          2,
          0,
        ),
      ],
      ceiling: null,
      connections,
    });
    expect(rows.find((row) => row.connectionId === KEY)?.stopsFirst.kind).toBe(
      "connection",
    );
  });

  // TEST_SCENARIO: another agent's limits never count this agent's calls, and a Connection with no limit counting it gets no row, nor does the agent's dollar spend when no dollar limit exists.
  it("ignores other agents' limits and leaves out unlimited rows", () => {
    const rows = bindingOf({
      agentId: AGENT,
      limits: [
        limit(
          "l-other",
          { kind: "connection", agentId: "agent-b", connectionId: KEY },
          "usd",
          1,
          0,
        ),
        limit(
          "l-other-agent",
          { kind: "agent", agentId: "agent-b" },
          "usd",
          1,
          0,
        ),
      ],
      ceiling: null,
      connections,
    });
    expect(rows).toEqual([]);
  });
});
