import type { Subscription } from "rxjs";
import {
  events$,
  ofType,
  EventType,
  type RuntimeHelloReceived,
} from "../../../events.js";
import { getLogger } from "../../../core/logger.js";
import { formatError } from "../../../core/format-error.js";
import type { DefaultConverter } from "../services/default-conversion.js";

const LISTING_WAIT_MS = 120_000;

export function startConvertDefaultOnHelloSaga(
  converter: DefaultConverter,
): Subscription {
  return events$()
    .pipe(ofType<RuntimeHelloReceived>(EventType.RuntimeHelloReceived))
    .subscribe((event) => {
      converter.ensure(event.agentId, LISTING_WAIT_MS).catch((err) => {
        getLogger().warn(
          { agentId: event.agentId, reason: formatError(err) },
          "harness-config.default_conversion_failed",
        );
      });
    });
}
