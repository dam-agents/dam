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

export interface TelegramBindFlowStore {
  create(bind: Omit<TelegramPendingBind, "createdAt">): string;
  /** TTL-checked read; an expired entry is deleted and reads as null.
   *  Deliberately not consuming — a CONFLICT bind leaves the flow alive so
   *  the user can pick a different agent within the TTL. */
  peek(flowId: string): TelegramPendingBind | null;
  consume(flowId: string): void;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;

/** In-memory, single-replica by design (like the OAuth pending-flow maps):
 *  the handoff lives well under the TTL, and the api-server runs one replica. */
export function createTelegramBindFlowStore(opts?: {
  now?: () => number;
  ttlMs?: number;
}): TelegramBindFlowStore {
  const now = opts?.now ?? (() => Date.now());
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const flows = new Map<string, TelegramPendingBind>();

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
    create(bind) {
      ensureJanitor();
      const flowId = randomUUID();
      flows.set(flowId, { ...bind, createdAt: now() });
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
