import type { RuntimeChannelQueues } from "../infrastructure/bullmq-queue.js";
import type { StateOutboxRepository } from "../infrastructure/state-outbox-repository.js";
import type { SignalOutboxRepository } from "../infrastructure/signal-outbox-repository.js";

export interface RuntimeChannelWriter {
  /** Marks the agent's desired state dirty. Bumps the version in the
   *  outbox row and enqueues a state-delivery job. Caller must already
   *  have committed the domain mutation that produced the change —
   *  this is post-commit. (Same-transaction option deferred until a
   *  caller actually needs it; phase 1 outbox writers are simple.) */
  notifyStateChanged(agentId: string): Promise<void>;
  /** Inserts a signal-outbox row and enqueues a delivery job. The id
   *  is the caller's idempotency key — re-inserts of the same id are
   *  no-ops. */
  enqueueSignal(input: {
    id: string;
    agentId: string;
    action: string;
    payload: Record<string, unknown>;
    ttlMs: number;
  }): Promise<void>;
  /** Per-agent cleanup hook. Removes outbox rows for an agent whose
   *  K8s ConfigMap has been deleted. */
  deleteForAgent(agentId: string): Promise<void>;
}

export interface RuntimeChannelWriterDeps {
  stateRepo: StateOutboxRepository;
  signalRepo: SignalOutboxRepository;
  queues: RuntimeChannelQueues;
  /** Monotonic version generator. Default uses Date.now() padded to
   *  preserve lexicographic order; tests pass a deterministic clock. */
  nextVersion?: () => string;
}

export function createRuntimeChannelWriter(
  deps: RuntimeChannelWriterDeps,
): RuntimeChannelWriter {
  const nextVersion = deps.nextVersion ?? defaultNextVersion;

  return {
    async notifyStateChanged(agentId) {
      const version = nextVersion();
      await deps.stateRepo.bumpVersion(agentId, version);
      await deps.queues.enqueueState({ agentId, version });
    },

    async enqueueSignal(input) {
      const expiresAt = new Date(Date.now() + input.ttlMs);
      await deps.signalRepo.insert({
        id: input.id,
        agentId: input.agentId,
        action: input.action,
        payload: input.payload,
        expiresAt,
      });
      await deps.queues.enqueueSignal({ signalId: input.id });
    },

    async deleteForAgent(agentId) {
      await deps.stateRepo.deleteForAgent(agentId);
      await deps.signalRepo.deleteForAgent(agentId);
    },
  };
}

/** Stringified timestamp with millisecond precision plus a 6-digit
 *  counter, zero-padded so lexicographic comparison matches numeric
 *  order. The counter handles two same-ms calls on one replica;
 *  cross-replica racing relies on Postgres serialization (last bump
 *  wins, which is correct because the latest mutation owns the final
 *  state). */
let counter = 0;
function defaultNextVersion(): string {
  counter = (counter + 1) % 1_000_000;
  const ms = Date.now().toString().padStart(15, "0");
  const c = counter.toString().padStart(6, "0");
  return `${ms}-${c}`;
}
