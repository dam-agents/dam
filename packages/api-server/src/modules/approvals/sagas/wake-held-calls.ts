import type { Subscription } from "rxjs";
import {
  events$,
  ofType,
  EventType,
  type ApprovalResolved,
} from "../../../events.js";
import type { RedisBus } from "../../../core/redis-bus.js";
import { approvalChannelOf } from "../services/ext-authz-gate.js";
import { getLogger } from "../../../core/logger.js";
import { formatError } from "../../../core/format-error.js";

export function startWakeHeldCallsSaga(bus: RedisBus): Subscription {
  return events$()
    .pipe(ofType<ApprovalResolved>(EventType.ApprovalResolved))
    .subscribe((event) => {
      bus.publish(approvalChannelOf(event.approvalId), "").catch((err) => {
        getLogger().warn(
          { approvalId: event.approvalId, reason: formatError(err) },
          "approvals.wake_publish_failed",
        );
      });
    });
}
