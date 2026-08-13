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
  };
}

let active: Subscription | null = null;
afterEach(() => {
  active?.unsubscribe();
  active = null;
});

describe("audit-log saga", () => {
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

  it("projects the messenger identity into detail, never into actor", () => {
    const h = harness();
    active = h.sub;
    emit({
      type: EventType.ChannelTurnRelayed,
      channel: "telegram",
      agentId: "agent-2",
      actorSub: null,
      externalActorId: "tg-777",
      outcome: "success",
    });
    const rec = h.records()[0]!;
    expect(rec.actor).toBe(null);
    expect(rec.actorKind).toBe("external");
    expect(rec.detail).toEqual({ externalActorId: "tg-777" });
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
    expect(rec.reason).toBeUndefined();
  });

  it("projects the failure reason onto the channel.turn line", () => {
    const h = harness();
    active = h.sub;
    emit({
      type: EventType.ChannelTurnRelayed,
      channel: "slack",
      agentId: "agent-3",
      actorSub: "kc-1",
      outcome: "failure",
      reason: "wake-timeout:agent-pod-failed:ImagePullFailure",
    });
    const rec = h.records()[0]!;
    expect(rec.reason).toBe("wake-timeout:agent-pod-failed:ImagePullFailure");
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
    expect(h.records()).toHaveLength(0);
  });
});
