import { concatMap, type Subscription } from "rxjs";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import {
  events$,
  EventType,
  ofType,
  type SpendLimitsChanged,
} from "../../../events.js";
import type { SchedulesRepository } from "../infrastructure/schedules-repository.js";
import type { ScheduleQueue } from "../infrastructure/schedule-queue.js";

export function startResumeHeldOnceSaga(deps: {
  repo: Pick<SchedulesRepository, "claimWaitingOnce">;
  queue: Pick<ScheduleQueue, "enqueue">;
  now?: () => Date;
}): Subscription {
  const now = deps.now ?? (() => new Date());
  return events$()
    .pipe(
      ofType<SpendLimitsChanged>(EventType.SpendLimitsChanged),
      concatMap(async (event) => {
        try {
          const at = now();
          for (const id of await deps.repo.claimWaitingOnce(event.ownerSub, at))
            await deps.queue.enqueue(id, at, at);
        } catch (err) {
          getLogger().error(
            { ownerSub: event.ownerSub, reason: formatError(err) },
            "schedules.held_once_resume_failed",
          );
        }
      }),
    )
    .subscribe();
}
