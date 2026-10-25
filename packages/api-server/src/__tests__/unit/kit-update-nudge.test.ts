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
  markLands?: boolean;
  frames?: string[];
}) {
  const marked: { pending: KitUpdatePending; at: string }[] = [];
  const sent: { agentId: string; text: string; notice?: boolean }[] = [];
  const nudge = createKitUpdateNudge({
    pending: async () => opts.pending,
    marks: {
      nudge: async (_agentId, expected, at) => {
        marked.push({ pending: expected, at });
        return opts.markLands ?? true;
      },
    },
    listSessions: async () => ({ sessions: opts.sessions }),
    history: async () => opts.frames ?? [],
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

function chunk(sessionUpdate: string, text: string): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "s-update",
      update: { sessionUpdate, content: { type: "text", text } },
    },
  });
}

const FORM_REPLY = [
  chunk("user_message_chunk", "Update the kit."),
  chunk("agent_message_chunk", "Which changes should I take?\n"),
  chunk(
    "agent_message_chunk",
    '<a2ui-json>\n[{"version":"v1.0"}]\n</a2ui-json>',
  ),
];

describe("kit update nudge", () => {
  // TEST_SCENARIO: the update session's turn ends with the update still pending. The agent gets one notice in that session that says how to report it, and the pending mark records that the reminder went out.
  it("reminds the agent once when the update session's turn ends", async () => {
    const h = harness({
      pending: pending(),
      sessions: [session("s-update")],
    });

    await h.nudge.turnEnded("agent-1", "s-update");

    expect(h.marked).toEqual([{ pending: pending(), at: NUDGED_AT }]);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.agentId).toBe("agent-1");
    expect(h.sent[0]?.notice).toBe(true);
    expect(h.sent[0]?.text).toContain("report_kit_updated");
    expect(h.sent[0]?.text).toContain(NEW);
  });

  // TEST_SCENARIO: the agent reports the update while the reminder is still reading its sessions. The mark then loses its compare-and-set, and the notice must not go out into a session whose update is already done.
  it("sends nothing when the mark loses to a report", async () => {
    const h = harness({
      pending: pending(),
      sessions: [session("s-update")],
      markLands: false,
    });

    await h.nudge.turnEnded("agent-1", "s-update");

    expect(h.marked).toHaveLength(1);
    expect(h.sent).toEqual([]);
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

  // TEST_SCENARIO: the update session's turn ends with a reply that asks the user through a chat form. A notice would answer in the user's place and lock the form, so nothing is sent and the reminder stays for a later turn end.
  it("waits while the turn's reply holds a form for the user", async () => {
    const h = harness({
      pending: pending(),
      sessions: [session("s-update")],
      frames: FORM_REPLY,
    });

    await h.nudge.turnEnded("agent-1", "s-update");

    expect(h.marked).toEqual([]);
    expect(h.sent).toEqual([]);
  });

  // TEST_SCENARIO: the user answered the form and the agent's next turn ends with plain text and the update still pending. Only the newest reply counts, so the form of the earlier turn no longer holds the reminder back.
  it("reminds once a later turn ends without a form", async () => {
    const h = harness({
      pending: pending(),
      sessions: [session("s-update")],
      frames: [
        ...FORM_REPLY,
        chunk("user_message_chunk", "Take all of them."),
        chunk("agent_message_chunk", "Done, the checkout is up to date."),
      ],
    });

    await h.nudge.turnEnded("agent-1", "s-update");

    expect(h.sent).toHaveLength(1);
  });
});
