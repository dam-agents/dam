import { concatMap, type Subscription } from "rxjs";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import {
  emit,
  events$,
  EventType,
  ofType,
  type ConnectionRemoved,
} from "../../../events.js";
import type { SpendLimits } from "../infrastructure/spend-limits.js";
import type { SpendQuestionCloser } from "../services/spend-service.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: A Connection's spend limits go with it: every
 * agent's limit on it and the owner's limit for all agents on it. Their
 * pending continue questions close too, because nothing they ask about is
 * left. The delete is by Connection id, so a replay deletes nothing more.
 */
export function startDropConnectionLimitsSaga(deps: {
  limits: SpendLimits;
  questions: SpendQuestionCloser;
}): Subscription {
  return events$()
    .pipe(
      ofType<ConnectionRemoved>(EventType.ConnectionRemoved),
      concatMap(async (event) => {
        try {
          const limitIds = await deps.limits.deleteForConnection(
            event.connectionKey,
          );
          if (limitIds.length === 0) return;
          emit({
            type: EventType.SpendLimitsChanged,
            ownerSub: event.actorSub,
          });
          for (const limitId of limitIds) {
            await deps.questions.closePending({
              ownerSub: event.actorSub,
              limitId,
            });
          }
        } catch (err) {
          getLogger().error(
            { connectionId: event.connectionKey, reason: formatError(err) },
            "spend.connection_limits_not_dropped",
          );
        }
      }),
    )
    .subscribe();
}
