import type { Subscription } from "rxjs";
import {
  events$,
  ofType,
  EventType,
  type RuntimeHelloReceived,
} from "../../../events.js";
import { getLogger } from "../../../core/logger.js";
import { formatError } from "../../../core/format-error.js";
import type { PublishSessionDefaults } from "../services/session-defaults-publisher.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: a runtime that just said hello may be new, or
 * may have missed a change while it was down, so it gets the agent's current
 * defaults again; an older runtime drops the event at send time.
 */
export function startPublishDefaultsOnHelloSaga(
  publish: PublishSessionDefaults,
): Subscription {
  return events$()
    .pipe(ofType<RuntimeHelloReceived>(EventType.RuntimeHelloReceived))
    .subscribe((event) => {
      publish(event.agentId).catch((err) => {
        getLogger().warn(
          { agentId: event.agentId, reason: formatError(err) },
          "harness-config.session_defaults_publish_failed",
        );
      });
    });
}
