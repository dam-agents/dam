import Redis, { type Redis as RedisClient } from "ioredis";

export type BusListener = (payload: string) => void;

export interface RedisBus {
  publish(channel: string, payload: string): Promise<void>;
  subscribe(channel: string, listener: BusListener): () => void;
  onReconnect?(listener: () => void): () => void;
  close(): Promise<void>;
}

export interface RedisBusOptions {
  password?: string;
}

export function createRedisBus(
  url: string,
  options: RedisBusOptions = {},
): RedisBus {
  const opts = {
    lazyConnect: false,
    maxRetriesPerRequest: null,
    password: options.password,
  };
  const publisher: RedisClient = new Redis(url, opts);
  const subscriber: RedisClient = new Redis(url, opts);

  const listeners = new Map<string, Set<BusListener>>();
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const SUBSCRIBE_RETRY_MS = 3_000;

  const reconnectListeners = new Set<() => void>();
  let everReady = false;
  subscriber.on("ready", () => {
    if (!everReady) {
      everReady = true;
      return;
    }
    for (const fn of reconnectListeners) {
      try {
        fn();
      } catch {}
    }
  });

  subscriber.on("message", (channel, payload) => {
    const set = listeners.get(channel);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch {}
    }
  });

  function ensureSubscribed(channel: string): void {
    void subscriber.subscribe(channel).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        "[redis-bus] subscribe-failed",
        JSON.stringify({ channel, error: msg }),
      );
      if (!listeners.has(channel) || retryTimers.has(channel)) return;
      const timer = setTimeout(() => {
        retryTimers.delete(channel);
        if (listeners.has(channel)) ensureSubscribed(channel);
      }, SUBSCRIBE_RETRY_MS);
      if (typeof timer.unref === "function") timer.unref();
      retryTimers.set(channel, timer);
    });
  }

  return {
    async publish(channel, payload) {
      try {
        await publisher.publish(channel, payload);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          "[redis-bus] publish-failed",
          JSON.stringify({ channel, error: msg }),
        );
      }
    },

    subscribe(channel, listener) {
      let set = listeners.get(channel);
      if (!set) {
        set = new Set();
        listeners.set(channel, set);
        ensureSubscribed(channel);
      }
      set.add(listener);

      return () => {
        const s = listeners.get(channel);
        if (!s) return;
        s.delete(listener);
        if (s.size === 0) {
          listeners.delete(channel);
          const timer = retryTimers.get(channel);
          if (timer) {
            clearTimeout(timer);
            retryTimers.delete(channel);
          }
          void subscriber.unsubscribe(channel).catch(() => {});
        }
      };
    },

    onReconnect(listener) {
      reconnectListeners.add(listener);
      return () => reconnectListeners.delete(listener);
    },

    async close() {
      for (const timer of retryTimers.values()) clearTimeout(timer);
      retryTimers.clear();
      await Promise.all([publisher.quit(), subscriber.quit()]);
    },
  };
}
