import { randomUUID } from "node:crypto";
import type { RedisBus } from "./redis-bus.js";

/**
 * Request/response over the Redis pub/sub bus, for calls that must execute on
 * a specific replica rather than wherever they landed. The channel workers
 * need it in one direction: a leader lease keeps Slack's socket and
 * Telegram's poller on one replica, but the agent's outbound `reply`/`react`
 * arrives over the MCP endpoint on whichever replica the harness Service
 * pinned its gateway to — so a non-leader has to hand the call across.
 *
 * Each replica subscribes to its own reply channel ONCE at construction and
 * correlates responses by request id. Subscribing per request would race:
 * `RedisBus.subscribe` issues its SUBSCRIBE without awaiting it, so a fast
 * response can land before the channel is live.
 *
 * Pub/sub is at-most-once and unacknowledged: a call whose leader dies
 * mid-flight rejects on timeout, and no retry happens here. Callers get an
 * error, which for a channel tool call surfaces to the agent as a failed
 * post — correct, since a silent retry could double-post to a conversation.
 */
export interface BusRpc<Req, Res> {
  /** Send `request` to the current server and await its response. Rejects on
   *  timeout (no server, or the server died mid-call). */
  call(request: Req): Promise<Res>;
  /** Start answering calls on this replica. Returns a stop function. Exactly
   *  one replica should serve at a time — the caller's lease decides. */
  serve(handler: (request: Req) => Promise<Res>): () => void;
  close(): void;
}

type Envelope<T> = { id: string; replyTo: string; body: T };
type Reply<T> =
  | { id: string; ok: true; body: T }
  | { id: string; ok: false; error: string };

export function createBusRpc<Req, Res>(opts: {
  bus: RedisBus;
  /** Names the request channel (`rpc:<service>`). */
  service: string;
  timeoutMs?: number;
  /** Wins the right to execute one request, exactly once across replicas.
   *  PUBLISH fans out to *every* subscriber, so during a lease handover — the
   *  old holder has not yet noticed it lost, the new one has already started
   *  serving — two replicas receive the same request and would both run it,
   *  double-posting to a conversation. Whoever claims the id executes; the
   *  other drops it. Omitted, every server executes (single-server setups and
   *  tests). */
  claim?: (requestId: string) => Promise<boolean>;
}): BusRpc<Req, Res> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const requestChannel = `rpc:${opts.service}`;
  const replyChannel = `rpc:${opts.service}:reply:${randomUUID()}`;

  const pending = new Map<
    string,
    {
      resolve: (v: Res) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  const unsubscribeReplies = opts.bus.subscribe(replyChannel, (payload) => {
    let reply: Reply<Res>;
    try {
      reply = JSON.parse(payload) as Reply<Res>;
    } catch {
      return;
    }
    const waiter = pending.get(reply.id);
    if (!waiter) return; // already timed out
    pending.delete(reply.id);
    clearTimeout(waiter.timer);
    if (reply.ok) waiter.resolve(reply.body);
    else waiter.reject(new Error(reply.error));
  });

  return {
    call(request) {
      const id = randomUUID();
      return new Promise<Res>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new Error(`${opts.service} rpc timed out after ${timeoutMs}ms`),
          );
        }, timeoutMs);
        timer.unref?.();
        pending.set(id, { resolve, reject, timer });
        void opts.bus.publish(
          requestChannel,
          JSON.stringify({
            id,
            replyTo: replyChannel,
            body: request,
          } satisfies Envelope<Req>),
        );
      });
    },

    serve(handler) {
      return opts.bus.subscribe(requestChannel, (payload) => {
        let envelope: Envelope<Req>;
        try {
          envelope = JSON.parse(payload) as Envelope<Req>;
        } catch {
          return;
        }
        void (async () => {
          // Before any side effect: a request we don't win belongs to another
          // replica, and running it too would duplicate the effect.
          if (opts.claim) {
            let won = false;
            try {
              won = await opts.claim(envelope.id);
            } catch {
              // Can't establish exclusivity — decline rather than risk a
              // double post. The caller times out and surfaces an error.
              return;
            }
            if (!won) return;
          }
          let reply: Reply<Res>;
          try {
            reply = {
              id: envelope.id,
              ok: true,
              body: await handler(envelope.body),
            };
          } catch (err) {
            reply = {
              id: envelope.id,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            };
          }
          await opts.bus.publish(envelope.replyTo, JSON.stringify(reply));
        })();
      });
    },

    close() {
      unsubscribeReplies();
      for (const { reject, timer } of pending.values()) {
        clearTimeout(timer);
        reject(new Error(`${opts.service} rpc closed`));
      }
      pending.clear();
    },
  };
}
