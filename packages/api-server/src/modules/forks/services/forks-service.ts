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
import type { ForkOrchestratorPort } from "../infrastructure/ports.js";

export interface OpenForkInput {
  instanceId: string;
  foreignSub: string;
  replyId: string;
  sessionId?: string;
}

export interface ForksService {
  openFork(input: OpenForkInput): Promise<void>;
  closeFork(forkId: string): Promise<void>;
}

export function createForksService(deps: {
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

      // The controller picks up the replier's K8s Secrets at render
      // time via foreignSub-labelled selectors (ADR-033).
      const fork = createFork({
        forkId,
        replyId: input.replyId,
        spec: {
          instanceId: input.instanceId,
          foreignSub: toForeignSub(input.foreignSub),
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
