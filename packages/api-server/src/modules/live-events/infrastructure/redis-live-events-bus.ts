import { liveEventSchema } from "api-server-api";
import type { RedisBus } from "../../../core/redis-bus.js";
import type { LiveEventsBus } from "../services/live-events-service.js";

const channelOf = (audience: string) => `events:owner:${audience}`;

export function createRedisLiveEventsBus(
  bus: RedisBus,
  log: (message: string) => void,
): LiveEventsBus {
  return {
    publish(audience, event) {
      void bus.publish(channelOf(audience), JSON.stringify(event));
    },
    subscribe(audience, listener) {
      const unsubscribe = bus.subscribe(channelOf(audience), (payload) => {
        let raw: unknown;
        try {
          raw = JSON.parse(payload);
        } catch {
          log(`dropped non-JSON frame on ${channelOf(audience)}`);
          return;
        }
        const parsed = liveEventSchema.safeParse(raw);
        if (!parsed.success) {
          log(`dropped unknown live event on ${channelOf(audience)}`);
          return;
        }
        listener(parsed.data);
      });
      const unsubscribeReconnect = bus.onReconnect?.(() =>
        listener({ topic: "sync" }),
      );
      return () => {
        unsubscribe();
        unsubscribeReconnect?.();
      };
    },
  };
}
