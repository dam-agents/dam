import { concatMap, type Subscription } from "rxjs";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import {
  events$,
  EventType,
  ofType,
  type GatewayCallEnded,
} from "../../../events.js";
import { outcomeOf } from "../../provider-status/index.js";
import type { FailedWorkStore } from "../infrastructure/redis-failed-work.js";

export function startRecordFailedWorkSaga(deps: {
  failedWork: FailedWorkStore;
}): Subscription {
  return events$()
    .pipe(
      ofType<GatewayCallEnded>(EventType.GatewayCallEnded),
      concatMap(async (event) => {
        const outcome = outcomeOf(event);
        if (!outcome?.failed || !event.sessionId || !event.callingAgentId)
          return;
        try {
          await deps.failedWork.record(
            outcome.templateId,
            {
              kind: "session",
              agentId: event.callingAgentId,
              sessionId: event.sessionId,
            },
            outcome.endedAt,
          );
        } catch (err) {
          getLogger().warn(
            { templateId: outcome.templateId, reason: formatError(err) },
            "outage_alerts.failed_work_unrecorded",
          );
        }
      }),
    )
    .subscribe();
}
