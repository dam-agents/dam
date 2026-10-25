import type { LiveEvent, LiveEventsService } from "api-server-api";

export type PublishableLiveEvent = Exclude<LiveEvent, { topic: "sync" }>;

export interface LiveEventsBus {
  publish(audience: string, event: PublishableLiveEvent): void;
  subscribe(audience: string, listener: (event: LiveEvent) => void): () => void;
}

const EDITOR_AUDIENCE_PREFIX = "email:";

export const editorAudience = (email: string) =>
  `${EDITOR_AUDIENCE_PREFIX}${email}`;

export const isEditorAudience = (audience: string) =>
  audience.startsWith(EDITOR_AUDIENCE_PREFIX);

const MAX_PENDING = 256;

export function createLiveEventsService(deps: {
  bus: LiveEventsBus;
}): LiveEventsService {
  return {
    async *ownerStream({ sub, editorEmail }, signal) {
      const pending: LiveEvent[] = [{ topic: "sync" }];
      let wake: (() => void) | undefined;
      const listener = (event: LiveEvent) => {
        if (pending.length >= MAX_PENDING) {
          pending.length = 0;
          pending.push({ topic: "sync" });
        } else {
          pending.push(event);
        }
        wake?.();
      };
      const unsubscribes = [
        deps.bus.subscribe(sub, listener),
        ...(editorEmail
          ? [deps.bus.subscribe(editorAudience(editorEmail), listener)]
          : []),
      ];
      const unsubscribe = () => unsubscribes.forEach((u) => u());
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
