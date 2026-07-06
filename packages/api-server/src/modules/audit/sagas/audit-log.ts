import { Subscription } from "rxjs";
import {
  events$,
  ofType,
  EventType,
  type DomainEvent,
  type ChannelTurnRelayed,
  type ScheduleFired,
  type FilesImported,
  type ForeignReplyReceived,
  type ForkReady,
  type ForkFailed,
  type ForkCompleted,
} from "../../../events.js";
import { getLogger } from "../../../core/logger.js";
import { securityLog } from "../../../core/security-log.js";
import { formatError } from "../../../core/format-error.js";

/**
 * Security-event saga: subscribes the in-process domain bus and writes a
 * forensic audit line for the success/observation events that already carry a
 * real actor. It is the bus-driven half of the audit trail; denials and the
 * mutations whose actor is only known at the call site are logged directly
 * there (so this saga and those call sites stay disjoint — no double-logging).
 *
 * Each handler PROJECTS explicit fields — never spread a whole event onto the
 * line, because some events (ForeignReplyReceived) carry the raw user prompt,
 * which must never reach the audit stream.
 *
 * Single-process, single-subscriber: one line per replica that handles the
 * event. Domain events must not be moved onto the cross-replica Redis bus
 * without dedup, or every replica's saga would duplicate every line.
 */
export function startAuditLogSaga(): Subscription {
  const sub = new Subscription();

  function on<T extends DomainEvent>(
    type: T["type"],
    handler: (event: T) => void,
  ): void {
    sub.add(
      events$()
        .pipe(ofType<T>(type))
        .subscribe((event) => {
          try {
            handler(event);
          } catch (err) {
            // A projection bug must never tear down the subscription.
            getLogger().error(
              { sourceEvent: type, reason: formatError(err) },
              "audit.saga_error",
            );
          }
        }),
    );
  }

  // NB: `UserAuthenticated` is deliberately NOT logged here. It fires on every
  // authenticated `/api/*` request (auth.ts middleware), not once per login —
  // the usage saga subscribes it precisely because it wants that per-request
  // signal, and collapses it to one row/day. A successful login is recorded
  // authoritatively by Keycloak's own authentication-event log; mirroring it
  // per-request here only floods the trail. Denied auth still surfaces here as
  // `authn.deny` / `authz.deny`, logged directly at the edge in auth.ts.

  on<ChannelTurnRelayed>(EventType.ChannelTurnRelayed, (e) =>
    securityLog(e.outcome === "failure" ? "warn" : "info", "channel.turn", {
      category: "channel",
      actor: e.actorSub,
      // Telegram relays have no Keycloak identity (actorSub null) — the
      // driver is an external messenger user.
      actorKind: e.actorSub ? "user" : "external",
      surface: e.channel,
      agentId: e.agentId,
      result: e.outcome,
      ...(e.reason ? { reason: e.reason } : {}),
      ...(e.forkId ? { detail: { forkId: e.forkId } } : {}),
    }),
  );

  on<ScheduleFired>(EventType.ScheduleFired, (e) =>
    securityLog(e.outcome === "failure" ? "warn" : "info", "schedule.fired", {
      category: "resource",
      // Unattended run on the owner's behalf — system-initiated, owner-owned.
      actor: e.ownerSub,
      actorKind: "system",
      surface: "scheduler",
      agentId: e.agentId,
      result: e.outcome,
      detail: {
        scheduleId: e.scheduleId,
        mode: e.mode,
        sessionId: e.sessionId,
      },
    }),
  );

  on<FilesImported>(EventType.FilesImported, (e) =>
    securityLog(e.outcome === "failure" ? "warn" : "info", "files.import", {
      category: "resource",
      actor: e.actorSub,
      actorKind: "user",
      agentId: e.agentId,
      result: e.outcome,
      detail: { bytes: e.bytes },
    }),
  );

  on<ForeignReplyReceived>(EventType.ForeignReplyReceived, (e) =>
    // The single most security-relevant channel action: a NON-owner driving
    // someone else's agent under their own credentials. Project
    // fields explicitly — e.prompt MUST NOT be logged.
    securityLog("info", "channel.foreign_turn.begin", {
      category: "channel",
      actor: e.foreignSub,
      actorKind: "user",
      surface: "slack",
      agentId: e.agentId,
      correlationId: e.replyId,
      detail: {
        threadTs: e.threadTs,
        channelId: e.slackContext.channelId,
        userSlackId: e.slackContext.userSlackId,
        ...(e.sessionId ? { sessionId: e.sessionId } : {}),
      },
    }),
  );

  on<ForkReady>(EventType.ForkReady, (e) =>
    securityLog("info", "fork.ready", {
      category: "resource",
      actor: null,
      actorKind: "system",
      correlationId: e.replyId,
      detail: { forkId: e.forkId },
    }),
  );

  on<ForkFailed>(EventType.ForkFailed, (e) =>
    securityLog("warn", "fork.failed", {
      // A credential-mint failure is a credential-path event, not just a
      // resource lifecycle blip — surface it as such.
      category: e.reason === "CredentialMintFailed" ? "credential" : "resource",
      actor: null,
      actorKind: "system",
      result: "failure",
      reason: e.reason,
      correlationId: e.replyId,
      detail: { forkId: e.forkId, ...(e.detail ? { detail: e.detail } : {}) },
    }),
  );

  on<ForkCompleted>(EventType.ForkCompleted, (e) =>
    securityLog("info", "fork.completed", {
      category: "resource",
      actor: null,
      actorKind: "system",
      correlationId: e.forkId,
    }),
  );

  return sub;
}
