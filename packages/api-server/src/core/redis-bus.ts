import Redis, { type Redis as RedisClient } from "ioredis";

export type BusListener = (payload: string) => void;

/**
 * Generic Redis pub/sub primitive. Channel names belong to the consumer:
 * approvals use `approval:<id>`, the ACP relay uses `inject:<instanceId>`,
 * etc. The bus is on the signal path only — Postgres remains the source of
 * truth for any durable state (DRAFT-redis-platform-primitive).
 */
export interface RedisBus {
  publish(channel: string, payload: string): Promise<void>;
  /** Returns an `unsubscribe` that callers MUST invoke. Listener sets and
   *  Redis SUBSCRIBE-state are reference-counted per channel. */
  subscribe(channel: string, listener: BusListener): () => void;
  close(): Promise<void>;
}

export function createRedisBus(url: string): RedisBus {
  // Two connections because a connection in subscribe mode can only execute
  // SUBSCRIBE / UNSUBSCRIBE / PING / QUIT.
  const publisher: RedisClient = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: null });
  const subscriber: RedisClient = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: null });

  const listeners = new Map<string, Set<BusListener>>();

  subscriber.on("message", (channel, payload) => {
    const set = listeners.get(channel);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload); } catch { /* listener errors must not affect siblings or the dispatcher */ }
    }
  });

  return {
    async publish(channel, payload) {
      try {
        await publisher.publish(channel, payload);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[redis-bus] publish-failed", JSON.stringify({ channel, error: msg }));
      }
    },

    subscribe(channel, listener) {
      let set = listeners.get(channel);
      if (!set) {
        set = new Set();
        listeners.set(channel, set);
        void subscriber.subscribe(channel).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn("[redis-bus] subscribe-failed", JSON.stringify({ channel, error: msg }));
        });
      }
      set.add(listener);

      return () => {
        const s = listeners.get(channel);
        if (!s) return;
        s.delete(listener);
        if (s.size === 0) {
          listeners.delete(channel);
          void subscriber.unsubscribe(channel).catch(() => {});
        }
      };
    },

    async close() {
      await Promise.all([publisher.quit(), subscriber.quit()]);
    },
  };
}
