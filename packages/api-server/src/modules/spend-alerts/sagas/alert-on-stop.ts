import { concatMap, type Subscription } from "rxjs";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import {
  events$,
  EventType,
  ofType,
  type SpendWorkStopped,
} from "../../../events.js";
import type { SpendAlertsService } from "../services/spend-alerts-service.js";

export function startAlertOnStopSaga(deps: {
  service: SpendAlertsService;
}): Subscription {
  return events$()
    .pipe(
      ofType<SpendWorkStopped>(EventType.SpendWorkStopped),
      concatMap(async (event) => {
        try {
          await deps.service.handle(event);
        } catch (err) {
          getLogger().warn(
            { ownerSub: event.ownerSub, reason: formatError(err) },
            "spend_alerts.failed",
          );
        }
      }),
    )
    .subscribe();
}
