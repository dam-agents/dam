import type { PromptEnvelope } from "../domain/types.js";
import type {
  PendingEntry,
  PromptsStore,
} from "../infrastructure/redis-prompts-store.js";
import type { ForwardPrompt } from "../infrastructure/wrapper-prompt-forwarder.js";

export interface PromptsForwarderDeps {
  store: PromptsStore;
  forward: ForwardPrompt;
  /** Per-replica unique consumer name. Allows XAUTOCLAIM to detect
   *  dead-replica work and reclaim it across instances. */
  consumerName: string;
  /** How long an unacked entry has to sit before XAUTOCLAIM picks it up.
   *  Bounds worst-case retry delay on transient forwarder failures. */
  reclaimIdleMs?: number;
  /** Per-loop block timeout for fresh reads. Doubles as the worst-case
   *  shutdown latency since `stop()` waits for the in-flight XREADGROUP to
   *  unblock. Default keeps that under typical K8s pod grace windows. */
  blockMs?: number;
  /** Cap per loop iteration; bounds memory + concurrency. */
  batchSize?: number;
  /** Sleep before retrying after a top-level loop error (Redis hiccup,
   *  XREADGROUP died, …). Avoids hot-spinning. */
  errorBackoffMs?: number;
  log?: (msg: string) => void;
}

export interface PromptsForwarder {
  start(): void;
  stop(): Promise<void>;
}

/**
 * Consumer-group worker that drains `prompts:outbox` and forwards each
 * envelope to the wrapper.
 *
 * Loop shape:
 *   1. XAUTOCLAIM — reclaim entries idle ≥ reclaimIdleMs (dead replicas,
 *      our own past failures). Process them first so retries don't get
 *      starved by a steady stream of fresh prompts.
 *   2. XREADGROUP "$" — block-read fresh entries.
 *   3. For each: call `forward(envelope)`. On success XACK + XDEL; on
 *      failure leave unacked so the next iteration's XAUTOCLAIM picks it
 *      up after the idle threshold.
 *
 * Single-replica is a degenerate case: the same consumer reclaims its own
 * stale entries. XAUTOCLAIM's contract ("any pending entry of any
 * consumer ≥ idle") covers this without special-casing.
 */
export function createPromptsForwarder(
  deps: PromptsForwarderDeps,
): PromptsForwarder {
  const reclaimIdleMs = deps.reclaimIdleMs ?? 30_000;
  const blockMs = deps.blockMs ?? 1_500;
  const batchSize = deps.batchSize ?? 10;
  const errorBackoffMs = deps.errorBackoffMs ?? 1_000;

  let running = false;
  let loopPromise: Promise<void> | null = null;

  async function processOne(entry: PendingEntry): Promise<void> {
    let envelope: PromptEnvelope;
    try {
      envelope = JSON.parse(entry.envelope) as PromptEnvelope;
    } catch (err) {
      // Malformed envelope — ack and drop. Retrying won't fix bad JSON,
      // and leaving it pending would block the consumer-group head
      // forever once XAUTOCLAIM keeps re-handing it back.
      const msg = err instanceof Error ? err.message : String(err);
      deps.log?.(`prompts-forwarder: dropping malformed entry ${entry.id}: ${msg}`);
      await deps.store.ack(entry.id);
      await deps.store.trim(entry.id);
      return;
    }
    try {
      await deps.forward(envelope);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.log?.(
        `prompts-forwarder: forward failed for ${envelope.promptId} (entry ${entry.id}): ${msg}`,
      );
      // Leave unacked — XAUTOCLAIM picks it up after reclaimIdleMs.
      return;
    }
    try {
      await deps.store.ack(entry.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.log?.(
        `prompts-forwarder: ack failed for ${envelope.promptId} (entry ${entry.id}): ${msg}`,
      );
      // Leave unacked — XAUTOCLAIM redelivers; wrapper-side LRU dedups.
      return;
    }
    try {
      await deps.store.trim(entry.id);
    } catch (err) {
      // Entry is acked (no redelivery) but still in the stream body. The
      // distinct log line lets ops detect persistent XDEL failures that
      // would otherwise grow `prompts:outbox` unboundedly without any
      // forward-side symptom.
      const msg = err instanceof Error ? err.message : String(err);
      deps.log?.(
        `prompts-forwarder: trim failed for ${envelope.promptId} (entry ${entry.id}, already acked): ${msg}`,
      );
    }
  }

  async function loop(): Promise<void> {
    await deps.store.ensureGroup();
    while (running) {
      try {
        const reclaimed = await deps.store.autoClaim(
          deps.consumerName,
          reclaimIdleMs,
          batchSize,
        );
        for (const entry of reclaimed) {
          if (!running) return;
          await processOne(entry);
        }

        if (!running) return;
        const fresh = await deps.store.read(deps.consumerName, batchSize, blockMs);
        for (const entry of fresh) {
          if (!running) return;
          await processOne(entry);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        deps.log?.(`prompts-forwarder: loop error: ${msg}`);
        await sleep(errorBackoffMs);
      }
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      loopPromise = loop();
    },
    async stop() {
      running = false;
      // The XREADGROUP BLOCK call holds the worker for up to `blockMs`;
      // wait for it to return naturally so we don't leak the connection
      // on shutdown.
      if (loopPromise) await loopPromise;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
