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
    ownerStream(sub, signal) {
      let unsubscribe = () => {};
      let end = () => {};
      return new ReadableStream<LiveEvent>({
        start(controller) {
          end = () => {
            unsubscribe();
            try {
              controller.close();
            } catch {}
          };
          controller.enqueue({ topic: "sync" });
          unsubscribe = deps.bus.subscribe(sub, (event) =>
            controller.enqueue(event),
          );
          signal?.addEventListener("abort", end, { once: true });
        },
        cancel() {
          signal?.removeEventListener("abort", end);
          unsubscribe();
        },
      });
    },
  };
}
