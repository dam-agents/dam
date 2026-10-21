import { concatMap, type Subscription } from "rxjs";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import {
  events$,
  EventType,
  ofType,
  type GatewayCallEnded,
} from "../../../events.js";
import { outcomeOf } from "../domain/outcome.js";
import type { CallWindow } from "../infrastructure/redis-call-window.js";

export function startCountGatewayCallsSaga(deps: {
  window: CallWindow;
}): Subscription {
  return events$()
    .pipe(
      ofType<GatewayCallEnded>(EventType.GatewayCallEnded),
      concatMap(async (event) => {
        const outcome = outcomeOf(event);
        if (!outcome) return;
        try {
          await deps.window.count(outcome);
        } catch (err) {
          getLogger().warn(
            { templateId: outcome.templateId, reason: formatError(err) },
            "provider_status.count_failed",
          );
        }
      }),
    )
    .subscribe();
}
