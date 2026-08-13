import { randomUUID } from "node:crypto";
import type { TtlStore } from "../../../core/ttl-store.js";

export interface TelegramOAuthPending {
  telegramUserId: string;
  threadId: string;
  codeVerifier: string;
  chatTitle?: string;
  createdAt: number;
}

export interface TelegramPendingBind {
  conversationId: string;
  telegramUserId: string;
  keycloakSub: string;
  chatTitle?: string;
  createdAt: number;
}

export interface FlowStore<T> {
  create(record: Omit<T, "createdAt">): Promise<string>;
  peek(flowId: string): Promise<T | null>;
  consume(flowId: string): Promise<void>;
}

export type TelegramBindFlowStore = FlowStore<TelegramPendingBind>;

export function createFlowStore<T extends { createdAt: number }>(opts: {
  now?: () => number;
  store: TtlStore<T>;
}): FlowStore<T> {
  const now = opts.now ?? (() => Date.now());
  const store = opts.store;

  return {
    async create(record) {
      const flowId = randomUUID();
      await store.set(flowId, { ...record, createdAt: now() } as T);
      return flowId;
    },

    async peek(flowId) {
      return store.peek(flowId);
    },

    async consume(flowId) {
      await store.delete(flowId);
    },
  };
}

export function createTelegramBindFlowStore(opts: {
  now?: () => number;
  store: TtlStore<TelegramPendingBind>;
}): TelegramBindFlowStore {
  return createFlowStore<TelegramPendingBind>(opts);
}
