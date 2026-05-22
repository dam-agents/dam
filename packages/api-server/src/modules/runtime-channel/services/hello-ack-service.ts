import type {
  RuntimeChannelHelloInput,
  RuntimeChannelHelloResult,
} from "api-server-api";
import type { StateOutboxRepository } from "../infrastructure/state-outbox-repository.js";
import type { SignalOutboxRepository } from "../infrastructure/signal-outbox-repository.js";
import type { CapabilityCache } from "./runtime-channel-worker.js";
import type { StateBuilder } from "./state-builder.js";

export interface HelloAckService {
  hello(input: {
    agentId: string;
    hello: RuntimeChannelHelloInput;
  }): Promise<RuntimeChannelHelloResult>;
  ack(input: { agentId: string; signalId: string }): Promise<void>;
}

export interface HelloAckServiceDeps {
  stateRepo: StateOutboxRepository;
  signalRepo: SignalOutboxRepository;
  stateBuilder: StateBuilder;
  capabilityCache: CapabilityCache;
}

export function createHelloAckService(
  deps: HelloAckServiceDeps,
): HelloAckService {
  return {
    async hello({ agentId, hello }) {
      deps.capabilityCache.set({
        agentId,
        kinds: new Set(hello.capabilities.kinds),
        signals: new Set(hello.capabilities.signals),
      });

      const row = await deps.stateRepo.get(agentId);
      const snapshot = await deps.stateBuilder.build({
        agentId,
        capabilityKinds: new Set(hello.capabilities.kinds),
      });

      const stateIfDiverged =
        snapshot.hash !== hello.lastAppliedHash
          ? {
              version: row?.version ?? defaultVersion(),
              hash: snapshot.hash,
              contributions: snapshot.contributions,
            }
          : undefined;

      const pending = await deps.signalRepo.listForAgent(agentId, new Date());
      const pendingSignals = pending
        .filter((s) => hello.capabilities.signals.includes(s.action))
        .map((s) => ({
          id: s.id,
          action: s.action,
          payload: s.payload,
          expiresAt: s.expiresAt.toISOString(),
        }));

      return { state: stateIfDiverged, pendingSignals };
    },

    async ack({ signalId }) {
      // Path-level Istio AuthorizationPolicy already proved the caller
      // is the agent the URL names; the row's `agent_id` is the same.
      // A second ack on an already-deleted row is a no-op.
      await deps.signalRepo.deleteById(signalId);
    },
  };
}

/** Fallback version when there's no outbox row yet but the agent's
 *  reported hash diverges. Happens on the very first hello from an
 *  agent before any mutation has produced state. */
function defaultVersion(): string {
  return `${Date.now().toString().padStart(15, "0")}-000000`;
}
