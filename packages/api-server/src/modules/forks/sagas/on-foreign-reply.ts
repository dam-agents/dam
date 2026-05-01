import type { Subscription } from "rxjs";
import { mergeMap } from "rxjs/operators";
import {
  events$,
  ofType,
  EventType,
  type ForeignReplyReceived,
} from "../../../events.js";
import type { ForksService } from "../services/forks-service.js";

/** Looks up the parent instance's `experimentalCredentialInjector` flag. The
 *  saga consults this to choose between the OneCLI mint path and the Envoy
 *  sidecar render path (ADR-033). Returns false on any read failure (we
 *  fall back to the legacy path rather than blocking the fork). */
export type ResolveExperimentalFlag = (instanceId: string) => Promise<boolean>;

export function startOnForeignReplySaga(
  forks: ForksService,
  resolveExperimentalFlag: ResolveExperimentalFlag,
): Subscription {
  return events$().pipe(
    ofType<ForeignReplyReceived>(EventType.ForeignReplyReceived),
    mergeMap(async (event) => {
      try {
        const experimentalCredentialInjector = await resolveExperimentalFlag(event.instanceId);
        await forks.openFork({
          instanceId: event.instanceId,
          foreignSub: event.foreignSub,
          replyId: event.replyId,
          experimentalCredentialInjector,
          ...(event.sessionId !== undefined ? { sessionId: event.sessionId } : {}),
        });
      } catch (err) {
        process.stderr.write(`[forks/on-foreign-reply] ${event.replyId}: ${err}\n`);
      }
    }),
  ).subscribe();
}
