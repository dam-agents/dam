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
            getLogger().error(
              { sourceEvent: type, reason: formatError(err) },
              "audit.saga_error",
            );
          }
        }),
    );
  }

  on<ChannelTurnRelayed>(EventType.ChannelTurnRelayed, (e) =>
    securityLog(e.outcome === "failure" ? "warn" : "info", "channel.turn", {
      category: "channel",
      actor: e.actorSub,
      actorKind: e.actorSub ? "user" : "external",
      surface: e.channel,
      agentId: e.agentId,
      result: e.outcome,
      ...(e.reason ? { reason: e.reason } : {}),
      ...(e.externalActorId
        ? { detail: { externalActorId: e.externalActorId } }
        : {}),
    }),
  );

  on<ScheduleFired>(EventType.ScheduleFired, (e) =>
    securityLog(e.outcome === "failure" ? "warn" : "info", "schedule.fired", {
      category: "resource",
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
