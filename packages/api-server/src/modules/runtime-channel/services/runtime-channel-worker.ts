import type { Worker } from "bullmq";
import type {
  RuntimeChannelQueues,
  SignalJobData,
  StateJobData,
} from "../infrastructure/bullmq-queue.js";
import {
  RuntimeChannelUnreachableError,
  type RuntimeChannelClient,
} from "../infrastructure/runtime-channel-client.js";
import type { StateOutboxRepository } from "../infrastructure/state-outbox-repository.js";
import type { SignalOutboxRepository } from "../infrastructure/signal-outbox-repository.js";
import type { StateBuilder } from "./state-builder.js";

/** Resolves an agent's current capabilities from in-memory cache.
 *  The runtime channel records what each agent advertised on its last
 *  `hello`. When the cache has no entry (cold replica, recent restart),
 *  the worker falls back to the broad set and lets the agent's own
 *  apply-time filter handle the result — strictly correct, only
 *  marginally less efficient. */
export interface CapabilityCache {
  getKinds(agentId: string): ReadonlySet<string> | undefined;
  getSignals(agentId: string): ReadonlySet<string> | undefined;
  set(input: {
    agentId: string;
    kinds: ReadonlySet<string>;
    signals: ReadonlySet<string>;
  }): void;
}

export interface RuntimeChannelWorkers {
  stateWorker: Worker<StateJobData>;
  signalWorker: Worker<SignalJobData>;
  close(): Promise<void>;
}

export interface RuntimeChannelWorkerDeps {
  queues: RuntimeChannelQueues;
  stateRepo: StateOutboxRepository;
  signalRepo: SignalOutboxRepository;
  client: RuntimeChannelClient;
  stateBuilder: StateBuilder;
  capabilityCache: CapabilityCache;
  log?: (msg: string) => void;
}

export function startRuntimeChannelWorkers(
  deps: RuntimeChannelWorkerDeps,
): RuntimeChannelWorkers {
  const log = deps.log ?? (() => {});

  const stateWorker = deps.queues.startStateWorker(async (job) => {
    const { agentId } = job.data;
    const row = await deps.stateRepo.get(agentId);
    if (!row) {
      log(`[runtime-channel:state] ${agentId}: row missing — no-op`);
      return;
    }
    const kinds = deps.capabilityCache.getKinds(agentId) ?? new Set<string>();
    const snapshot = await deps.stateBuilder.build({
      agentId,
      capabilityKinds: kinds,
    });
    if (snapshot.hash === row.lastAppliedHash) {
      log(`[runtime-channel:state] ${agentId}: hash unchanged — short-circuit`);
      return;
    }
    try {
      const result = await deps.client.applyState(agentId, {
        version: row.version,
        hash: snapshot.hash,
        contributions: snapshot.contributions,
      });
      await deps.stateRepo.markApplied({
        agentId,
        appliedHash: result.appliedHash,
        appliedAt: new Date(),
      });
      if (result.rejected) {
        log(
          `[runtime-channel:state] ${agentId}: rejected ${result.rejected.reason}`,
        );
      }
    } catch (e) {
      if (e instanceof RuntimeChannelUnreachableError) {
        log(`[runtime-channel:state] ${agentId}: unreachable — sweep retry`);
        return;
      }
      throw e;
    }
  });

  const signalWorker = deps.queues.startSignalWorker(async (job) => {
    const { signalId } = job.data;
    const row = await deps.signalRepo.get(signalId);
    if (!row) {
      log(`[runtime-channel:signal] ${signalId}: row missing — already acked`);
      return;
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      log(`[runtime-channel:signal] ${signalId}: ttl expired — dropping`);
      await deps.signalRepo.deleteById(signalId);
      return;
    }
    const signals = deps.capabilityCache.getSignals(row.agentId);
    if (signals && !signals.has(row.action)) {
      log(
        `[runtime-channel:signal] ${signalId}: agent ${row.agentId} does not support action ${row.action} — dropping`,
      );
      await deps.signalRepo.deleteById(signalId);
      return;
    }
    try {
      await deps.client.deliverSignal(row.agentId, {
        id: row.id,
        action: row.action,
        payload: row.payload,
        expiresAt: row.expiresAt.toISOString(),
      });
    } catch (e) {
      if (e instanceof RuntimeChannelUnreachableError) {
        log(`[runtime-channel:signal] ${signalId}: unreachable — sweep retry`);
        return;
      }
      throw e;
    }
    // Note: the agent's ack is what deletes the row. The worker does not
    // delete on successful delivery — ADR-048 makes the agent's ack the
    // single commit point.
  });

  return {
    stateWorker,
    signalWorker,
    async close() {
      await stateWorker.close();
      await signalWorker.close();
    },
  };
}

export function createCapabilityCache(): CapabilityCache {
  const kindsByAgent = new Map<string, ReadonlySet<string>>();
  const signalsByAgent = new Map<string, ReadonlySet<string>>();
  return {
    getKinds: (agentId) => kindsByAgent.get(agentId),
    getSignals: (agentId) => signalsByAgent.get(agentId),
    set: ({ agentId, kinds, signals }) => {
      kindsByAgent.set(agentId, kinds);
      signalsByAgent.set(agentId, signals);
    },
  };
}
