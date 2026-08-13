import type { LiveEvent, LiveEventsService } from "api-server-api";

export type PublishableLiveEvent = Exclude<LiveEvent, { topic: "sync" }>;

export interface LiveEventsBus {
  publish(ownerSub: string, event: PublishableLiveEvent): void;
  subscribe(ownerSub: string, listener: (event: LiveEvent) => void): () => void;
}

const MAX_PENDING = 256;

export function createLiveEventsService(deps: {
  bus: LiveEventsBus;
}): LiveEventsService {
  return {
    async *ownerStream(sub, signal) {
      const pending: LiveEvent[] = [{ topic: "sync" }];
      let wake: (() => void) | undefined;
      const unsubscribe = deps.bus.subscribe(sub, (event) => {
        if (pending.length >= MAX_PENDING) {
          pending.length = 0;
          pending.push({ topic: "sync" });
        } else {
          pending.push(event);
        }
        wake?.();
      });
      const onAbort = () => wake?.();
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        while (!signal?.aborted) {
          const next = pending.shift();
          if (next === undefined) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            wake = undefined;
            continue;
          }
          yield next;
        }
      } finally {
        signal?.removeEventListener("abort", onAbort);
        unsubscribe();
      }
    },
  };
}
