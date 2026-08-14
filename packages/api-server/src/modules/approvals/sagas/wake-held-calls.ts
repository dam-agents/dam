import type { Subscription } from "rxjs";
import {
  events$,
  ofType,
  EventType,
  type ApprovalResolved,
} from "../../../events.js";
import type { ApprovalsBus } from "../infrastructure/redis-approvals-bus.js";
import { getLogger } from "../../../core/logger.js";
import { formatError } from "../../../core/format-error.js";

export function startWakeHeldCallsSaga(
  bus: Pick<ApprovalsBus, "notifyResolved">,
): Subscription {
  return events$()
    .pipe(ofType<ApprovalResolved>(EventType.ApprovalResolved))
    .subscribe((event) => {
      bus.notifyResolved(event.approvalId).catch((err) => {
        getLogger().warn(
          { approvalId: event.approvalId, reason: formatError(err) },
          "approvals.wake_publish_failed",
        );
      });
    });
}
