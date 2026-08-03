import { Subscription } from "rxjs";
import {
  events$,
  ofType,
  EventType,
  type DomainEvent,
  type ChannelTurnRelayed,
  type ScheduleFired,
  type FilesImported,
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
 * line, so an event that carries payload content can never leak it into the
 * audit stream.
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
      // `actor` stays Keycloak-sub space; the messenger-native driver id
      // rides `detail`, never `actor`.
      ...(e.externalActorId
        ? { detail: { externalActorId: e.externalActorId } }
        : {}),
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

  return sub;
}
