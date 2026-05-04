import type { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type ForeignReplyReceived,
} from "../../../events.js";
import type { ForksService } from "../services/forks-service.js";

export function startOnForeignReplySaga(forks: ForksService): Subscription {
  return events$().pipe(
    ofType<ForeignReplyReceived>(EventType.ForeignReplyReceived),
    mergeMap(async (event) => {
      try {
        await forks.openFork({
          instanceId: event.instanceId,
          foreignSub: event.foreignSub,
          replyId: event.replyId,
          ...(event.sessionId !== undefined ? { sessionId: event.sessionId } : {}),
        });
      } catch (err) {
        process.stderr.write(`[forks/on-foreign-reply] ${event.replyId}: ${err}\n`);
      }
    }),
  ).subscribe();
}
