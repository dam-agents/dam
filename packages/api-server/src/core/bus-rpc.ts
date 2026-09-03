import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { RedisBus } from "./redis-bus.js";

export interface BusRpc<Req, Res> {
  call(request: Req): Promise<Res>;
  serve(handler: (request: Req) => Promise<Res>): () => void;
  close(): void;
}

type Envelope<T> = { id: string; replyTo: string; body: T };
type Reply<T> =
  | { id: string; ok: true; body: T }
  | { id: string; ok: false; error: string };

const envelopeSchema = z.object({
  id: z.string(),
  replyTo: z.string(),
  body: z.unknown(),
});
const replySchema = z.union([
  z.object({ id: z.string(), ok: z.literal(true), body: z.unknown() }),
  z.object({ id: z.string(), ok: z.literal(false), error: z.string() }),
]);

export function createBusRpc<Req, Res>(opts: {
  bus: RedisBus;
  service: string;
  timeoutMs?: number;
  claim?: (requestId: string) => Promise<boolean>;
  requestSchema?: z.ZodType<Req>;
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
      reply = replySchema.parse(JSON.parse(payload)) as Reply<Res>;
    } catch {
      return;
    }
    const waiter = pending.get(reply.id);
    if (!waiter) return;
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
          const parsed = envelopeSchema.parse(JSON.parse(payload));
          const body = opts.requestSchema
            ? opts.requestSchema.parse(parsed.body)
            : (parsed.body as Req);
          envelope = { id: parsed.id, replyTo: parsed.replyTo, body };
        } catch {
          return;
        }
        void (async () => {
          if (opts.claim) {
            let won = false;
            try {
              won = await opts.claim(envelope.id);
            } catch {
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
