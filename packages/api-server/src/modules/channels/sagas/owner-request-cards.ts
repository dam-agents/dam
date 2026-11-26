import { merge, mergeMap, type Subscription } from "rxjs";
import { filter } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type ApprovalRequested,
  type ApprovalResolved,
  type ApprovalRouteRaised,
  type ApprovalWaitChanged,
} from "../../../events.js";
import { getLogger } from "../../../core/logger.js";
import { formatError } from "../../../core/format-error.js";

// UNIT_BOUNDARY_DESCRIPTION: puts each routed request on its owner's Slack card, on the channels leader through channel RPC: a new request with a route, and a request a Slack turn raised to the `turn` route. When the waits of a routed request change, the cards and the thread lines of its agent are drawn again; when a routed request settles, wherever and however, its items on every card settle. A failure is logged and the next event goes on; the sweep repairs what a lost event missed.
export function startOwnerRequestCardsSaga(deps: {
  place: (approvalId: string) => Promise<unknown>;
  waitChanged: (approvalId: string) => Promise<unknown>;
  settle: (approvalId: string) => Promise<unknown>;
}): Subscription {
  const placements = merge(
    events$().pipe(
      ofType<ApprovalRequested>(EventType.ApprovalRequested),
      filter((event) => event.ownerRoute !== undefined),
    ),
    events$().pipe(ofType<ApprovalRouteRaised>(EventType.ApprovalRouteRaised)),
  ).pipe(
    mergeMap(async (event) => {
      await deps
        .place(event.approvalId)
        .catch((err: unknown) =>
          getLogger().warn(
            { approvalId: event.approvalId, error: formatError(err) },
            "owner_request.place_saga_failed",
          ),
        );
    }),
  );
  const waits = events$().pipe(
    ofType<ApprovalWaitChanged>(EventType.ApprovalWaitChanged),
    mergeMap(async (event) => {
      await deps
        .waitChanged(event.approvalId)
        .catch((err: unknown) =>
          getLogger().warn(
            { approvalId: event.approvalId, error: formatError(err) },
            "owner_request.wait_saga_failed",
          ),
        );
    }),
  );
  const settles = events$().pipe(
    ofType<ApprovalResolved>(EventType.ApprovalResolved),
    filter((event) => event.ownerRoute !== undefined),
    mergeMap(async (event) => {
      await deps
        .settle(event.approvalId)
        .catch((err: unknown) =>
          getLogger().warn(
            { approvalId: event.approvalId, error: formatError(err) },
            "owner_request.settle_saga_failed",
          ),
        );
    }),
  );
  return merge(placements, waits, settles).subscribe();
}
