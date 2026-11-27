// TEST_OVERVIEW: an agent is stopped by a limit when a call of its sessions was refused today and a limit that counts that call is still reached; the limit named is the reached one with the least left, then the one set closest to the agent.
import type {
  SpendCeilingView,
  SpendLimitScope,
  SpendLimitView,
} from "api-server-api";
import { describe, expect, it } from "vitest";

import {
  type DayRefusal,
  stoppedAgent,
} from "../../modules/spend/domain/stopped.js";
import type { SpendUnit } from "../../modules/spend/domain/units.js";

const AGENT = "agent-a";
const KEY = "conn-key";
const PLAN = "conn-plan";
const NAMES = new Map([
  [KEY, "Anthropic"],
  [PLAN, "Claude subscription"],
]);
const usd = (dollars: number) => Math.round(dollars * 1_000_000);

function limit(
  id: string,
  scope: SpendLimitScope,
  amount: number,
  spent: number,
  unit: SpendUnit = "usd",
): SpendLimitView {
  const left = Math.max(0, usd(amount) - usd(spent));
  return {
    id,
    scope,
    unit,
    amountMicros: usd(amount),
    extensions: 0,
    effectiveMicros: usd(amount),
    spentMicros: usd(spent),
    leftMicros: left,
    state: left === 0 ? "reached" : "ok",
  };
}

const refusal = (
  connectionId: string,
  sessionId: string,
  unit: SpendUnit = "usd",
): DayRefusal => ({ payerAgentId: AGENT, connectionId, sessionId, unit });

const reachedCeiling: SpendCeilingView = {
  amountMicros: usd(50),
  spentMicros: usd(50),
  state: "reached",
  source: "default",
};

function stopped(
  refusals: readonly DayRefusal[],
  limits: readonly SpendLimitView[],
  ceiling: SpendCeilingView | null = null,
) {
  return stoppedAgent({
    agentId: AGENT,
    refusals,
    limits,
    ceiling,
    connectionNames: NAMES,
  });
}

describe("stoppedAgent", () => {
  it("names the reached agent limit after a refused call, with its sessions", () => {
    const result = stopped(
      [refusal(KEY, "s1"), refusal(KEY, "s2"), refusal(KEY, "s1")],
      [limit("l-agent", { kind: "agent", agentId: AGENT }, 5, 5)],
    );

    expect(result).toEqual({
      agentId: AGENT,
      sessionIds: ["s1", "s2"],
      limit: {
        kind: "agent",
        limitId: "l-agent",
        connectionId: null,
        connectionName: null,
        unit: "usd",
        amountMicros: usd(5),
        leftMicros: 0,
      },
    });
  });

  it("is not stopped once the owner raised the limit that refused the call", () => {
    const result = stopped(
      [refusal(KEY, "s1")],
      [limit("l-agent", { kind: "agent", agentId: AGENT }, 10, 5)],
    );

    expect(result).toBeNull();
  });

  it("is not stopped by a reached limit when no call was refused", () => {
    const result = stopped(
      [],
      [limit("l-agent", { kind: "agent", agentId: AGENT }, 5, 5)],
    );

    expect(result).toBeNull();
  });

  it("names the provider limit for all agents with its provider", () => {
    const result = stopped(
      [refusal(KEY, "s1")],
      [
        limit("l-all", { kind: "owner-connection", connectionId: KEY }, 20, 20),
        limit("l-total", { kind: "owner" }, 40, 30),
      ],
    );

    expect(result?.limit).toMatchObject({
      kind: "owner-connection",
      connectionId: KEY,
      connectionName: "Anthropic",
    });
  });

  it("names the limit set closest to the agent when two are reached", () => {
    const result = stopped(
      [refusal(KEY, "s1")],
      [
        limit("l-total", { kind: "owner" }, 40, 40),
        limit("l-agent", { kind: "agent", agentId: AGENT }, 5, 5),
      ],
    );

    expect(result?.limit.kind).toBe("agent");
  });

  it("never stops a subscription call by a dollar limit", () => {
    const result = stopped(
      [refusal(PLAN, "s1", "usd_list")],
      [limit("l-agent", { kind: "agent", agentId: AGENT }, 5, 5)],
      reachedCeiling,
    );

    expect(result).toBeNull();
  });

  it("names the operator's spend ceiling when it refused a paid call", () => {
    const result = stopped([refusal(KEY, "s1")], [], reachedCeiling);

    expect(result?.limit).toMatchObject({
      kind: "ceiling",
      limitId: null,
      amountMicros: usd(50),
    });
  });
});
