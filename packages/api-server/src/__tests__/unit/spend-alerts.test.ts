// TEST_OVERVIEW: when a spend limit or the ceiling stops work that the owner does not see stop (a schedule, an ambient turn, a mention in Slack or Telegram), the owner gets one message per level that stopped it: the highest reached limit decides the level, a repeat at the same level sends nothing, a new level sends again, and the message names an agent only for that agent's own limit.
import type { SessionCategory } from "api-server-api";
import { describe, expect, it } from "vitest";

import { EventType, type SpendWorkStopped } from "../../events.js";
import {
  readCeiling,
  readLimit,
  stopOf,
  type SpendLimit,
} from "../../modules/spend/domain/limits.js";
import type { StopNotice } from "../../modules/spend-alerts/domain/messages.js";
import { createSpendAlertsService } from "../../modules/spend-alerts/services/spend-alerts-service.js";

const OWNER = "owner-1";
const DOLLAR = 1_000_000;

function limit(
  id: string,
  scope: SpendLimit["scope"],
  amountMicros = 5 * DOLLAR,
  extensions = 0,
): SpendLimit {
  return {
    id,
    ownerSub: OWNER,
    scope,
    unit: "usd",
    amountMicros,
    extensions,
  };
}

function stopped(
  level: SpendWorkStopped["level"],
  work: SpendWorkStopped["work"] = { kind: "schedule" },
): SpendWorkStopped {
  return {
    type: EventType.SpendWorkStopped,
    ownerSub: OWNER,
    payer: "agent-1",
    day: "2026-10-30",
    level,
    near: [],
    work,
  };
}

function limitLevel(
  limitId: string,
  extensions = 0,
  amountMicros = 5 * DOLLAR,
): SpendWorkStopped["level"] {
  return {
    kind: "limit",
    limitId,
    scope: { kind: "agent", agentId: "agent-1" },
    unit: "usd",
    amountMicros,
    extensions,
  };
}

function harness(categories: Record<string, SessionCategory> = {}) {
  const keys = new Set<string>();
  const sent: StopNotice[] = [];
  const service = createSpendAlertsService({
    told: {
      told: async (key) => keys.has(key),
      claim: async (key) => {
        if (keys.has(key)) return false;
        keys.add(key);
        return true;
      },
    },
    notify: async (_owner, notice) => {
      sent.push(notice);
      return { sent: 1 };
    },
    agentName: async () => "Theodore",
    connectionNames: async () => new Map([["conn-1", "LiteLLM"]]),
    sessionCategories: async () => new Map(Object.entries(categories)),
    uiBaseUrl: "https://dam.example",
    now: () => new Date("2026-10-30T15:00:00Z"),
  });
  return { service, sent };
}

describe("spend stop level", () => {
  // TEST_SCENARIO: the agent limit and the own limit are both reached; the own limit counts more work, so the stop is about it, and the agent limit shows as near.
  it("picks the highest reached limit", () => {
    const agent = readLimit(
      limit("agent", { kind: "agent", agentId: "agent-1" }),
      6 * DOLLAR,
    );
    const owner = readLimit(limit("owner", { kind: "owner" }), 6 * DOLLAR);
    const stop = stopOf(null, [agent, owner]);
    expect(stop?.level).toMatchObject({ kind: "limit", limitId: "owner" });
    expect(stop?.near.map((n) => n.level)).toEqual([
      expect.objectContaining({ limitId: "agent" }),
    ]);
  });

  // TEST_SCENARIO: a reached Connection limit stops the work; the ceiling at 90% is listed as near, and a limit at half is not.
  it("lists only levels at their warning share as near", () => {
    const connection = readLimit(
      limit("conn", {
        kind: "connection",
        agentId: "agent-1",
        connectionId: "conn-1",
      }),
      5 * DOLLAR,
    );
    const agent = readLimit(
      limit("agent", { kind: "agent", agentId: "agent-1" }),
      2.5 * DOLLAR,
    );
    const ceiling = readCeiling(
      { amountMicros: 10 * DOLLAR, source: "operator" },
      9 * DOLLAR,
    );
    const stop = stopOf(ceiling, [connection, agent]);
    expect(stop?.level).toMatchObject({ kind: "limit", limitId: "conn" });
    expect(stop?.near.map((n) => n.level.kind)).toEqual(["ceiling"]);
  });

  // TEST_SCENARIO: the ceiling is reached; it stops the work above every limit.
  it("puts the ceiling above every limit", () => {
    const owner = readLimit(limit("owner", { kind: "owner" }), 12 * DOLLAR);
    const ceiling = readCeiling(
      { amountMicros: 10 * DOLLAR, source: "operator" },
      12 * DOLLAR,
    );
    expect(stopOf(ceiling, [owner])?.level).toEqual({
      kind: "ceiling",
      amountMicros: 10 * DOLLAR,
    });
  });
});

describe("spend stop messages", () => {
  // TEST_SCENARIO: a 15-minute schedule is held three times by the same limit at the same level; the owner gets one message.
  it("sends once per level", async () => {
    const { service, sent } = harness();
    for (let i = 0; i < 3; i++) await service.handle(stopped(limitLevel("a")));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.slack).toContain(
      "*Theodore stopped: its spend limit is reached*",
    );
    expect(sent[0]?.slack).toContain("$5.00 today. Its paid model calls stop");
    expect(sent[0]?.slack).toContain(
      "<https://dam.example/sandboxes/agent-1/usage|Change the limit>",
    );
  });

  // TEST_SCENARIO: the owner continues, or raises the limit, and the work stops again; each new level sends a new message.
  it("sends again at a new level", async () => {
    const { service, sent } = harness();
    await service.handle(stopped(limitLevel("a")));
    await service.handle(stopped(limitLevel("a", 1)));
    await service.handle(stopped(limitLevel("a", 1, 8 * DOLLAR)));
    expect(sent).toHaveLength(3);
  });

  // TEST_SCENARIO: the gate refuses a call in a web chat Session, which the owner watches, then in a scheduled Session and a Slack channel Session; only the last two send, one per level.
  it("tells about refused calls the owner does not see", async () => {
    const { service, sent } = harness({
      chat: "chats",
      run: "scheduled",
      thread: "channels",
    });
    await service.handle(
      stopped(limitLevel("a"), {
        kind: "call",
        agentId: "agent-1",
        sessionId: "chat",
      }),
    );
    expect(sent).toHaveLength(0);
    await service.handle(
      stopped(limitLevel("a"), {
        kind: "call",
        agentId: "agent-1",
        sessionId: "run",
      }),
    );
    expect(sent).toHaveLength(1);
    await service.handle(
      stopped(limitLevel("b"), {
        kind: "call",
        agentId: "agent-1",
        sessionId: "thread",
      }),
    );
    expect(sent).toHaveLength(2);
  });

  // TEST_SCENARIO: a Connection limit for all agents stops the work; the message speaks for all agents and links to Settings › Providers, where that limit is set.
  it("links a limit to the page that sets it", async () => {
    const { service, sent } = harness();
    await service.handle(
      stopped({
        kind: "limit",
        limitId: "shared",
        scope: { kind: "owner-connection", connectionId: "conn-1" },
        unit: "usd",
        amountMicros: 5 * DOLLAR,
        extensions: 0,
      }),
    );
    expect(sent[0]?.slack).toContain(
      "*Your agents stopped: your LiteLLM spend limit for all agents is reached*",
    );
    expect(sent[0]?.slack).toContain(
      "Calls of all your agents on LiteLLM stop",
    );
    expect(sent[0]?.slack).toContain(
      "<https://dam.example/settings/providers|Change the limit>",
    );
    expect(sent[0]?.slack).not.toContain("Theodore");
  });

  // TEST_SCENARIO: the ceiling stops the work; the message points to the platform operator and offers no Continue.
  it("points to the operator at the ceiling", async () => {
    const { service, sent } = harness();
    await service.handle(
      stopped({ kind: "ceiling", amountMicros: 10 * DOLLAR }),
    );
    expect(sent[0]?.slack).toContain(
      "*Your agents stopped: your spend ceiling is reached*",
    );
    expect(sent[0]?.slack).toContain(
      "<https://dam.example/settings/usage|See your spend>",
    );
    expect(sent[0]?.slack).toContain(
      "Only the platform operator can raise it.",
    );
    expect(sent[0]?.slack).not.toContain("Continue");
    expect(sent[0]?.slack).not.toContain("Theodore");
  });
});
