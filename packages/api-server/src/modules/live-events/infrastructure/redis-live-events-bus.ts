import { liveEventSchema } from "api-server-api";
import type { RedisBus } from "../../../core/redis-bus.js";
import type { LiveEventsBus } from "../services/live-events-service.js";

const channelOf = (ownerSub: string) => `events:owner:${ownerSub}`;

export function createRedisLiveEventsBus(
  bus: RedisBus,
  log: (message: string) => void,
): LiveEventsBus {
  return {
    publish(ownerSub, event) {
      void bus.publish(channelOf(ownerSub), JSON.stringify(event));
    },
    subscribe(ownerSub, listener) {
      const unsubscribe = bus.subscribe(channelOf(ownerSub), (payload) => {
        let raw: unknown;
        try {
          raw = JSON.parse(payload);
        } catch {
          log(`dropped non-JSON frame on ${channelOf(ownerSub)}`);
          return;
        }
        const parsed = liveEventSchema.safeParse(raw);
        if (!parsed.success) {
          log(`dropped unknown live event on ${channelOf(ownerSub)}`);
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
