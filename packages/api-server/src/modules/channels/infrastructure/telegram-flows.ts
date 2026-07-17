import { randomUUID } from "node:crypto";

/** A /login begun in a Telegram chat, waiting for the Keycloak callback.
 *  Carries no agent — the owner picks one in the UI after authenticating. */
export interface TelegramOAuthPending {
  telegramUserId: string;
  /** SDK-encoded conversation id the /login was sent in. */
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
  create(record: Omit<T, "createdAt">): string;
  /** TTL-checked read; an expired entry is deleted and reads as null.
   *  Deliberately not consuming — callers consume only on success, so a
   *  recoverable failure leaves the flow alive within the TTL. */
  peek(flowId: string): T | null;
  consume(flowId: string): void;
}

export type TelegramBindFlowStore = FlowStore<TelegramPendingBind>;

const DEFAULT_TTL_MS = 10 * 60 * 1000;

/** In-memory, single-replica by design (like the OAuth pending-flow maps):
 *  the handoff lives well under the TTL, and the api-server runs one replica. */
export function createFlowStore<T extends { createdAt: number }>(opts?: {
  now?: () => number;
  ttlMs?: number;
}): FlowStore<T> {
  const now = opts?.now ?? (() => Date.now());
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const flows = new Map<string, T>();

  let janitor: ReturnType<typeof setInterval> | null = null;
  function ensureJanitor() {
    if (janitor != null) return;
    janitor = setInterval(() => {
      const cutoff = now() - ttlMs;
      for (const [k, v] of flows) {
        if (v.createdAt < cutoff) flows.delete(k);
      }
    }, 60_000);
    janitor.unref?.();
  }

  return {
    create(record) {
      ensureJanitor();
      const flowId = randomUUID();
      flows.set(flowId, { ...record, createdAt: now() } as T);
      return flowId;
    },

    peek(flowId) {
      const flow = flows.get(flowId);
      if (!flow) return null;
      if (now() - flow.createdAt > ttlMs) {
        flows.delete(flowId);
        return null;
      }
      return flow;
    },

    consume(flowId) {
      flows.delete(flowId);
    },
  };
}

export function createTelegramBindFlowStore(opts?: {
  now?: () => number;
  ttlMs?: number;
}): TelegramBindFlowStore {
  return createFlowStore<TelegramPendingBind>(opts);
}
