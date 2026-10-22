import { concatMap, type Subscription } from "rxjs";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import {
  events$,
  EventType,
  ofType,
  type ProviderStatusEvaluated,
} from "../../../events.js";
import type { OutageAlertsService } from "../services/outage-alerts-service.js";

export function startAlertOnOutageSaga(deps: {
  service: OutageAlertsService;
}): Subscription {
  return events$()
    .pipe(
      ofType<ProviderStatusEvaluated>(EventType.ProviderStatusEvaluated),
      concatMap(async (event) => {
        try {
          await deps.service.handle(event);
        } catch (err) {
          getLogger().warn(
            { reason: formatError(err) },
            "outage_alerts.evaluation_failed",
          );
        }
      }),
    )
    .subscribe();
}
