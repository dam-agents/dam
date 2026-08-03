import { randomUUID } from "node:crypto";
import {
  createMemoryTtlStore,
  type TtlStore,
} from "../../../core/ttl-store.js";

/** A bind begun in a Telegram chat, waiting for the Keycloak callback.
 *  Carries no agent — the owner picks one in the UI after authenticating. */
export interface TelegramOAuthPending {
  telegramUserId: string;
  /** SDK-encoded conversation id the bind was started in. */
  threadId: string;
  codeVerifier: string;
  /** Best-effort human title of the chat, shown on the bind page. */
  chatTitle?: string;
  createdAt: number;
}

/** A completed Keycloak login waiting for the owner to pick an Agent in the
 *  UI. The record is the bearer capability behind `?flow=<id>`: it pins the
 *  authenticated sub, so only that user's session can consume it. */
export interface TelegramPendingBind {
  conversationId: string;
  telegramUserId: string;
  keycloakSub: string;
  chatTitle?: string;
  createdAt: number;
}

export interface FlowStore<T> {
  create(record: Omit<T, "createdAt">): Promise<string>;
  /** Non-consuming read — callers consume only on success, so a
   *  recoverable failure leaves the flow alive within the TTL. */
  peek(flowId: string): Promise<T | null>;
  consume(flowId: string): Promise<void>;
}

export type TelegramBindFlowStore = FlowStore<TelegramPendingBind>;

const DEFAULT_TTL_MS = 10 * 60 * 1000;

/** Cross-replica flow store: the browser leg of a bind handoff may land on a
 *  different api-server replica than the chat leg that started it. Backed by
 *  a shared TtlStore (Redis in production, in-memory in tests). */
export function createFlowStore<T extends { createdAt: number }>(opts?: {
  now?: () => number;
  ttlMs?: number;
  store?: TtlStore<T>;
}): FlowStore<T> {
  const now = opts?.now ?? (() => Date.now());
  const store =
    opts?.store ?? createMemoryTtlStore<T>(opts?.ttlMs ?? DEFAULT_TTL_MS, now);

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

export function createTelegramBindFlowStore(opts?: {
  now?: () => number;
  ttlMs?: number;
  store?: TtlStore<TelegramPendingBind>;
}): TelegramBindFlowStore {
  return createFlowStore<TelegramPendingBind>(opts);
}
