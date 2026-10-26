import { concatMap, merge, type Subscription } from "rxjs";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import {
  events$,
  EventType,
  ofType,
  PROVIDER_UNAVAILABLE_TURN_REASON,
  type ChannelTurnRelayed,
  type GatewayCallEnded,
} from "../../../events.js";
import { outcomeOf } from "../../provider-status/index.js";
import type { FailedWork } from "../domain/failed-work.js";
import type { FailedWorkStore } from "../infrastructure/redis-failed-work.js";

export function startRecordFailedWorkSaga(deps: {
  failedWork: FailedWorkStore;
}): Subscription {
  const record = async (templateId: string, work: FailedWork, at: Date) => {
    try {
      await deps.failedWork.record(templateId, work, at);
    } catch (err) {
      getLogger().warn(
        { templateId, reason: formatError(err) },
        "outage_alerts.failed_work_unrecorded",
      );
    }
  };
  const failedCalls = events$().pipe(
    ofType<GatewayCallEnded>(EventType.GatewayCallEnded),
    concatMap(async (event) => {
      const outcome = outcomeOf(event);
      if (!outcome?.failed || !event.sessionId || !event.callingAgentId) return;
      await record(
        outcome.templateId,
        {
          kind: "session",
          agentId: event.callingAgentId,
          sessionId: event.sessionId,
        },
        outcome.endedAt,
      );
    }),
  );
  const failedAmbientTurns = events$().pipe(
    ofType<ChannelTurnRelayed>(EventType.ChannelTurnRelayed),
    concatMap(async (event) => {
      if (
        !event.ambient ||
        event.outcome !== "failure" ||
        event.reason !== PROVIDER_UNAVAILABLE_TURN_REASON ||
        !event.templateId
      )
        return;
      await record(
        event.templateId,
        { kind: "ambient", agentId: event.agentId, channel: event.channel },
        new Date(),
      );
    }),
  );
  return merge(failedCalls, failedAmbientTurns).subscribe();
}
