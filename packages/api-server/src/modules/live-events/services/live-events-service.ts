import type { LiveEvent, LiveEventsService } from "api-server-api";

export type PublishableLiveEvent = Exclude<LiveEvent, { topic: "sync" }>;

export interface LiveEventsBus {
  publish(ownerSub: string, event: PublishableLiveEvent): void;
  subscribe(ownerSub: string, listener: (event: LiveEvent) => void): () => void;
}

export function createLiveEventsService(deps: {
  bus: LiveEventsBus;
}): LiveEventsService {
  return {
    async *ownerStream(sub, signal) {
      const pending: LiveEvent[] = [];
      const queued = new Set<string>();
      let wake: (() => void) | undefined;
      const unsubscribe = deps.bus.subscribe(sub, (event) => {
        const key = JSON.stringify(event);
        if (queued.has(key)) return;
        queued.add(key);
        pending.push(event);
        wake?.();
      });
      const onAbort = () => wake?.();
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        yield { topic: "sync" } satisfies LiveEvent;
        while (!signal?.aborted) {
          const next = pending.shift();
          if (next === undefined) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            wake = undefined;
            continue;
          }
          queued.delete(JSON.stringify(next));
          yield next;
        }
      } finally {
        signal?.removeEventListener("abort", onAbort);
        unsubscribe();
      }
    },
  };
}
