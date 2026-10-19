import type { Lock, StateAdapter } from "chat";

/**
 * UNIT_BOUNDARY_DESCRIPTION: An in-memory Chat SDK state adapter for specs
 * that drive the Telegram Chat SDK wiring. It keeps locks, subscriptions and
 * values in maps, so the SDK's per-chat lock and subscription routing behave
 * as they do on Postgres without a database.
 */
export function createMemoryState(): StateAdapter {
  const values = new Map<string, unknown>();
  const lists = new Map<string, unknown[]>();
  const locks = new Map<string, string>();
  const subscribed = new Set<string>();
  const queues = new Map<string, unknown[]>();
  let token = 0;
  return {
    async acquireLock(threadId) {
      if (locks.has(threadId)) return null;
      const value = `t${(token += 1)}`;
      locks.set(threadId, value);
      return { threadId, token: value } as Lock;
    },
    async releaseLock(lock) {
      if (locks.get(lock.threadId) === lock.token) locks.delete(lock.threadId);
    },
    async forceReleaseLock(threadId) {
      locks.delete(threadId);
    },
    async extendLock() {
      return true;
    },
    async appendToList(key, value) {
      lists.set(key, [...(lists.get(key) ?? []), value]);
    },
    async getList<T>(key: string) {
      return (lists.get(key) ?? []) as T[];
    },
    async get<T>(key: string) {
      return (values.get(key) ?? null) as T | null;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async setIfNotExists(key, value) {
      if (values.has(key)) return false;
      values.set(key, value);
      return true;
    },
    async delete(key) {
      values.delete(key);
    },
    async isSubscribed(threadId) {
      return subscribed.has(threadId);
    },
    async subscribe(threadId) {
      subscribed.add(threadId);
    },
    async unsubscribe(threadId) {
      subscribed.delete(threadId);
    },
    async enqueue(threadId, entry) {
      const q = queues.get(threadId) ?? [];
      q.push(entry);
      queues.set(threadId, q);
      return q.length;
    },
    async dequeue(threadId) {
      const q = queues.get(threadId) ?? [];
      return (q.shift() ?? null) as never;
    },
    async queueDepth(threadId) {
      return (queues.get(threadId) ?? []).length;
    },
    async connect() {},
    async disconnect() {},
  };
}
