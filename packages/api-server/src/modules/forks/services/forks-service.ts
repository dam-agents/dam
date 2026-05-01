import { randomUUID } from "node:crypto";
import {
  EventType,
  emit as defaultEmit,
  type DomainEvent,
  type ForkFailureReason,
} from "../../../events.js";
import {
  createFork,
  markCompleted,
  markFailed,
  markReady,
  toForeignSub,
  type Fork,
} from "../domain/fork.js";
import type {
  ForeignCredentialsPort,
  ForkOrchestratorPort,
} from "../infrastructure/ports.js";

export interface OpenForkInput {
  instanceId: string;
  foreignSub: string;
  replyId: string;
  sessionId?: string;
  /**
   * Parent instance's `experimentalCredentialInjector` flag. When `true`,
   * the foreign-credentials mint (RFC 8693 token exchange + OneCLI
   * fork-agent registration) is skipped — the controller resolves
   * credentials from the replier's K8s Secrets at render time (ADR-033).
   */
  experimentalCredentialInjector?: boolean;
}

export interface ForksService {
  openFork(input: OpenForkInput): Promise<void>;
  closeFork(forkId: string): Promise<void>;
}

export function createForksService(deps: {
  foreignCredentials: ForeignCredentialsPort;
  orchestrator: ForkOrchestratorPort;
  emit?: (event: DomainEvent) => void;
  generateForkId?: () => string;
}): ForksService {
  const emit = deps.emit ?? defaultEmit;
  const generateForkId = deps.generateForkId ?? randomUUID;
  const open = new Map<string, Fork>();

  function emitFailed(fork: Fork, reason: ForkFailureReason, detail?: string): void {
    const next = markFailed(fork, reason, detail);
    if (!next.ok) return;
    open.delete(fork.forkId);
    emit({
      type: EventType.ForkFailed,
      forkId: fork.forkId,
      replyId: fork.replyId,
      reason,
      ...(detail !== undefined ? { detail } : {}),
    });
  }

  async function consumeStatus(initial: Fork): Promise<void> {
    let current = initial;
    for await (const status of deps.orchestrator.watchStatus(current.forkId)) {
      if (status.phase === "Ready" && status.podIP) {
        const next = markReady(current, status.podIP);
        if (!next.ok) continue;
        current = next.fork;
        open.set(current.forkId, current);
        emit({
          type: EventType.ForkReady,
          forkId: current.forkId,
          replyId: current.replyId,
          podIP: status.podIP,
        });
        continue;
      }
      if (status.phase === "Failed") {
        emitFailed(
          current,
          status.error?.reason ?? "OrchestrationFailed",
          status.error?.detail,
        );
        return;
      }
    }
  }

  return {
    async openFork(input) {
      const forkId = generateForkId();

      // Envoy path (ADR-033): no OneCLI fork-agent, no minted access
      // token. The controller picks up the replier's K8s Secrets at render
      // time via foreignSub-labelled selectors.
      if (input.experimentalCredentialInjector) {
        const fork = createFork({
          forkId,
          replyId: input.replyId,
          spec: {
            instanceId: input.instanceId,
            foreignSub: toForeignSub(input.foreignSub),
            forkAgentIdentifier: "",
            ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
          },
        });
        open.set(forkId, fork);

        const created = await deps.orchestrator.createFork({
          forkId,
          spec: fork.spec,
        });
        if (!created.ok) {
          const detail =
            created.error.kind === "WriteFailed" ? created.error.detail : created.error.kind;
          emitFailed(fork, "OrchestrationFailed", detail);
          return;
        }

        void consumeStatus(fork);
        return;
      }

      // Legacy OneCLI path: mint foreign-user token, inline into ConfigMap.
      const minted = await deps.foreignCredentials.mintForeignToken({
        foreignSub: input.foreignSub,
        instanceId: input.instanceId,
      });
      if (!minted.ok) {
        const pending = createFork({
          forkId,
          replyId: input.replyId,
          spec: {
            instanceId: input.instanceId,
            foreignSub: toForeignSub(input.foreignSub),
            forkAgentIdentifier: "",
            ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
          },
        });
        open.set(forkId, pending);
        emitFailed(pending, "CredentialMintFailed", minted.error.detail);
        return;
      }

      const fork = createFork({
        forkId,
        replyId: input.replyId,
        spec: {
          instanceId: input.instanceId,
          foreignSub: toForeignSub(input.foreignSub),
          forkAgentIdentifier: minted.value.agentIdentifier,
          ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
        },
      });
      open.set(forkId, fork);

      const created = await deps.orchestrator.createFork({
        forkId,
        spec: fork.spec,
        accessToken: minted.value.accessToken,
      });
      if (!created.ok) {
        const detail =
          created.error.kind === "WriteFailed" ? created.error.detail : created.error.kind;
        emitFailed(fork, "OrchestrationFailed", detail);
        return;
      }

      void consumeStatus(fork);
    },

    async closeFork(forkId) {
      const fork = open.get(forkId);
      if (!fork) return;
      const next = markCompleted(fork);
      open.delete(forkId);
      if (!next.ok) return;
      await deps.orchestrator.deleteFork(forkId);
      emit({ type: EventType.ForkCompleted, forkId });
    },
  };
}
