import type { Subscription } from "rxjs";
import {
  events$,
  ofType,
  EventType,
  type RuntimeHelloReceived,
} from "../../../events.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: an Agent says hello when it wakes, restarts or
 * lands on a new image, which is the one moment before its next run when a
 * provider it is missing can be attached without a run waiting for it; the
 * grant itself decides whether this Agent needs one.
 */
export function startGrantSharedCurveBenderOnHelloSaga(
  grant: (agentId: string) => Promise<void>,
): Subscription {
  return events$()
    .pipe(ofType<RuntimeHelloReceived>(EventType.RuntimeHelloReceived))
    .subscribe((event) => {
      void grant(event.agentId);
    });
}
