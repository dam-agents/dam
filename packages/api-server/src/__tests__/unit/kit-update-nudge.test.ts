// TEST_OVERVIEW: the one reminder a pending Kit Update gets — sent into the update Session when that Session's turn ends, once per update, and never to a Session the update did not open.
import type { Session } from "agent-runtime-api";
import { describe, expect, it } from "vitest";
import type { KitUpdatePending } from "api-server-api";

import { createKitUpdateNudge } from "../../modules/starter-kits/services/kit-update-nudge.js";

const NEW = "b".repeat(40);
const STARTED = "2026-10-20T10:00:00.000Z";
const NUDGED_AT = "2026-10-20T11:00:00.000Z";

function pending(extra: Partial<KitUpdatePending> = {}): KitUpdatePending {
  return { targetCommit: NEW, startedAt: STARTED, ...extra };
}

function session(sessionId: string, overrides: Partial<Session> = {}): Session {
  return {
    sessionId,
    mode: "chat",
    type: "regular",
    createdAt: "2026-10-20T10:00:20.000Z",
    updatedAt: null,
    title: null,
    scheduleId: null,
    threadTs: null,
    seenAt: null,
    runStartedAt: null,
    runTotalMs: null,
    runCount: null,
    running: false,
    initialization: true,
    ...overrides,
  };
}

function harness(opts: {
  pending: KitUpdatePending | null;
  sessions: Session[];
}) {
  const marked: KitUpdatePending[] = [];
  const sent: { agentId: string; text: string; notice?: boolean }[] = [];
  const nudge = createKitUpdateNudge({
    pending: async () => opts.pending,
    marks: {
      nudge: async (_agentId, next) => {
        marked.push(next);
      },
    },
    listSessions: async () => ({ sessions: opts.sessions }),
    send: async (agentId, payload) => {
      sent.push({
        agentId,
        text: payload.text,
        ...(payload.notice ? { notice: payload.notice } : {}),
      });
    },
    now: () => new Date(NUDGED_AT),
  });
  return { nudge, marked, sent };
}

describe("kit update nudge", () => {
  // TEST_SCENARIO: the update session's turn ends with the update still pending. The agent gets one notice in that session that says how to report it, and the pending mark records that the reminder went out.
  it("reminds the agent once when the update session's turn ends", async () => {
    const h = harness({
      pending: pending(),
      sessions: [session("s-update")],
    });

    await h.nudge.turnEnded("agent-1", "s-update");

    expect(h.marked).toEqual([{ ...pending(), nudgedAt: NUDGED_AT }]);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.agentId).toBe("agent-1");
    expect(h.sent[0]?.notice).toBe(true);
    expect(h.sent[0]?.text).toContain("report_kit_updated");
    expect(h.sent[0]?.text).toContain(NEW);
  });

  // TEST_SCENARIO: the agent reported or cancelled the update, so no turn end has anything to remind it of.
  it("says nothing once no update is pending", async () => {
    const h = harness({ pending: null, sessions: [session("s-update")] });

    await h.nudge.turnEnded("agent-1", "s-update");

    expect(h.marked).toEqual([]);
    expect(h.sent).toEqual([]);
  });

  // TEST_SCENARIO: the reminder already went out for this update. A second turn end, and a Continue of the same target, must not nag the agent again.
  it("never reminds twice for the same update", async () => {
    const h = harness({
      pending: pending({ nudgedAt: NUDGED_AT }),
      sessions: [session("s-update")],
    });

    await h.nudge.turnEnded("agent-1", "s-update");

    expect(h.marked).toEqual([]);
    expect(h.sent).toEqual([]);
  });

  // TEST_SCENARIO: a turn ended in a chat the update did not open — an ordinary session, or one older than the update, or one the agent no longer lists. None of them carries the update, so the reminder must not land there.
  it("leaves a session the update did not open alone", async () => {
    for (const sessions of [
      [session("s-chat", { initialization: false })],
      [session("s-old", { createdAt: "2026-10-20T09:00:00.000Z" })],
      [session("s-scheduled", { type: "schedule_cron" })],
      [],
    ]) {
      const h = harness({ pending: pending(), sessions });
      await h.nudge.turnEnded("agent-1", sessions[0]?.sessionId ?? "s-missing");
      expect(h.marked).toEqual([]);
      expect(h.sent).toEqual([]);
    }
  });
});
