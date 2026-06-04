import { describe, it, expect, afterEach } from "vitest";
import type { Subscription } from "rxjs";
import { configureLogger } from "../../core/logger.js";
import { startAuditLogSaga } from "../../modules/audit/sagas/audit-log.js";
import { emit, EventType } from "../../events.js";

function harness() {
  const lines: string[] = [];
  configureLogger({ level: "info", write: (l) => lines.push(l) });
  const sub = startAuditLogSaga();
  return {
    sub,
    records: () => lines.map((l) => JSON.parse(l)),
    raw: () => lines.join(""),
  };
}

let active: Subscription | null = null;
afterEach(() => {
  active?.unsubscribe();
  active = null;
});

describe("audit-log saga", () => {
  it("logs a foreign-reply turn WITHOUT leaking the prompt", () => {
    const h = harness();
    active = h.sub;
    emit({
      type: EventType.ForeignReplyReceived,
      replyId: "reply-1",
      agentId: "agent-1",
      foreignSub: "kc-foreign",
      threadTs: "1700000000.0001",
      prompt: "SUPER-SECRET-PROMPT-do-not-log",
      slackContext: { channelId: "C123", userSlackId: "U999" },
    });
    const rec = h.records()[0]!;
    expect(rec.msg).toBe("channel.foreign_turn.begin");
    expect(rec.category).toBe("channel");
    expect(rec.actor).toBe("kc-foreign");
    expect(rec.agentId).toBe("agent-1");
    expect(rec.correlationId).toBe("reply-1");
    // The raw prompt must never appear anywhere on the audit stream.
    expect(h.raw()).not.toContain("SUPER-SECRET-PROMPT");
    expect(JSON.stringify(rec)).not.toContain("prompt");
  });

  it("attributes a Telegram turn (no Keycloak sub) as an external actor", () => {
    const h = harness();
    active = h.sub;
    emit({
      type: EventType.ChannelTurnRelayed,
      channel: "telegram",
      agentId: "agent-2",
      actorSub: null,
      outcome: "success",
    });
    const rec = h.records()[0]!;
    expect(rec.msg).toBe("channel.turn");
    expect(rec.actor).toBe(null);
    expect(rec.actorKind).toBe("external");
    expect(rec.surface).toBe("telegram");
    expect(rec.level).toBe("info");
  });

  it("logs a failed channel turn at warn", () => {
    const h = harness();
    active = h.sub;
    emit({
      type: EventType.ChannelTurnRelayed,
      channel: "slack",
      agentId: "agent-3",
      actorSub: "kc-1",
      outcome: "failure",
    });
    const rec = h.records()[0]!;
    expect(rec.level).toBe("warn");
    expect(rec.result).toBe("failure");
  });

  it("does not log auth.login: per-request UserAuthenticated is intentionally ignored", () => {
    const h = harness();
    active = h.sub;
    emit({
      type: EventType.UserAuthenticated,
      userSub: "kc-2",
      surface: "other",
      isCore: false,
    });
    // The usage saga consumes this per-request event; the audit trail must not,
    // or an open UI's polling would flood it. Real logins live in Keycloak.
    expect(h.records()).toHaveLength(0);
  });

  it("flags a credential-mint fork failure as a credential event", () => {
    const h = harness();
    active = h.sub;
    emit({
      type: EventType.ForkFailed,
      forkId: "fork-1",
      replyId: "reply-9",
      reason: "CredentialMintFailed",
    });
    const rec = h.records()[0]!;
    expect(rec.msg).toBe("fork.failed");
    expect(rec.category).toBe("credential");
    expect(rec.level).toBe("warn");
    expect(rec.reason).toBe("CredentialMintFailed");
  });
});
