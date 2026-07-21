import {
  EventType,
  emit as defaultEmit,
  type DomainEvent,
  type ForkFailureReason,
} from "../../../events.js";
import { isDefunct, toForeignSub, type ForkPhase } from "../domain/fork.js";
import type { ForkOrchestratorPort } from "../infrastructure/ports.js";

export interface EnsureForkInput {
  agentId: string;
  foreignSub: string;
  replyId: string;
}

/** Acting context a fork id resolves to — consumed by the MCP endpoint and
 *  the ext-authz gate to tell a replier's turn from the parent's (#2843). */
export interface ForkIdentity {
  forkId: string;
  parentAgentId: string;
  foreignSub: string;
  /** The fork agent pod's IP while Ready; null when hibernated/starting. */
  podIP: string | null;
}

export interface ForksService {
  /**
   * Resolve the (agent, replier) fork — creating it on first contact, waking
   * it from hibernation, or rebuilding a defunct one — and emit
   * ForkReady/ForkFailed for this replyId once it settles. The Fork CR is
   * the state; nothing is held in memory, so an api-server restart forgets
   * nothing (#2843).
   */
  ensureFork(input: EnsureForkInput): Promise<void>;
  /**
   * Stamp fork activity (a turn was relayed). The idle tiers — hibernate in
   * minutes, expire in days — measure from this.
   */
  recordActivity(forkId: string): Promise<void>;
  /** Delete the fork outright ("end now"). The controller's GC sweeps the
   *  rest via owner references. */
  endFork(forkId: string): Promise<void>;
  /**
   * Resolve a fork id into its acting context. Null when no such fork
   * exists — including ids that merely look fork-shaped.
   */
  resolveIdentity(forkId: string): Promise<ForkIdentity | null>;
  /** The forks running against one parent agent (owner's visibility). */
  listByAgent(agentId: string): Promise<ForkSummary[]>;
  /** The forks acting as one user (their budget itemization). */
  listByReplier(foreignSub: string): Promise<ForkSummary[]>;
  /**
   * The replier's credential set changed — poke their forks so the
   * controller rolls each gateway now, not on the next turn (which would
   * race the roll and egress with stale credentials).
   */
  pokeCredentials(foreignSub: string): Promise<void>;
}

/** Read-model row for the fork visibility surfaces (#2843). */
export interface ForkSummary {
  forkId: string;
  parentAgentId: string;
  foreignSub: string;
  phase: ForkPhase | null;
  /** Live pods (reserving budget) vs hibernated/starting. */
  podRunning: boolean;
  lastActivityAt: string | null;
}

export function createForksService(deps: {
  orchestrator: ForkOrchestratorPort;
  forkIdFor: (agentId: string, foreignSub: string) => string;
  emit?: (event: DomainEvent) => void;
}): ForksService {
  const emit = deps.emit ?? defaultEmit;

  function emitFailed(
    forkId: string,
    replyId: string,
    reason: ForkFailureReason,
    detail?: string,
  ): void {
    emit({
      type: EventType.ForkFailed,
      forkId,
      replyId,
      reason,
      ...(detail !== undefined ? { detail } : {}),
    });
  }

  // Follow the CR's status until it settles for this turn. Pending and
  // Hibernated are transitional (the activity bump wakes a hibernated fork
  // through the ordinary provisioning path); a stream that ends without a
  // terminal phase means the CR vanished mid-watch (expired, or ended by the
  // owner) and the turn cannot proceed.
  async function settle(forkId: string, replyId: string): Promise<void> {
    for await (const status of deps.orchestrator.watchStatus(forkId)) {
      if (status.phase === "Ready" && status.podIP) {
        emit({
          type: EventType.ForkReady,
          forkId,
          replyId,
          podIP: status.podIP,
        });
        return;
      }
      if (status.phase === "Failed") {
        emitFailed(
          forkId,
          replyId,
          status.error?.reason ?? "OrchestrationFailed",
          status.error?.detail,
        );
        return;
      }
    }
    emitFailed(
      forkId,
      replyId,
      "OrchestrationFailed",
      "fork disappeared while starting",
    );
  }

  // Slot preparation is single-flighted per fork id: two concurrent replies
  // hitting a defunct slot must not interleave one ensure's delete with the
  // other's fresh create — the unconditional delete would destroy the CR
  // its peer just rebuilt, failing a reply that should have succeeded.
  const preparing = new Map<
    string,
    Promise<{ ok: true } | { ok: false; detail?: string }>
  >();

  async function prepareSlot(
    forkId: string,
    agentId: string,
    foreignSub: string,
  ): Promise<{ ok: true } | { ok: false; detail?: string }> {
    const existing = await deps.orchestrator.getFork(forkId);
    // A defunct fork blocks its (agent, replier) slot — clear it and
    // rebuild rather than resurfacing a stale failure. The controller
    // already tore its pods down when it failed.
    if (existing && isDefunct(existing.status)) {
      await deps.orchestrator.deleteFork(forkId);
    }
    if (!existing || isDefunct(existing.status)) {
      const created = await deps.orchestrator.createFork({
        forkId,
        spec: { agentId, foreignSub: toForeignSub(foreignSub) },
      });
      // AlreadyExists means a concurrent ensure won the create — the
      // watch settles against the same CR either way.
      if (!created.ok && created.error.kind !== "AlreadyExists") {
        return { ok: false, detail: created.error.detail };
      }
    }
    return { ok: true };
  }

  return {
    async ensureFork(input) {
      const forkId = deps.forkIdFor(input.agentId, input.foreignSub);
      try {
        let prep = preparing.get(forkId);
        if (!prep) {
          prep = prepareSlot(forkId, input.agentId, input.foreignSub).finally(
            () => preparing.delete(forkId),
          );
          preparing.set(forkId, prep);
        }
        const prepared = await prep;
        if (!prepared.ok) {
          emitFailed(
            forkId,
            input.replyId,
            "OrchestrationFailed",
            prepared.detail,
          );
          return;
        }
        // The bump is both the keep-warm stamp and the wake poke — fresh
        // activity re-enters the controller's provisioning path.
        await deps.orchestrator.bumpActivity(forkId);
      } catch (err) {
        emitFailed(forkId, input.replyId, "OrchestrationFailed", String(err));
        return;
      }
      await settle(forkId, input.replyId);
    },

    async recordActivity(forkId) {
      await deps.orchestrator.bumpActivity(forkId);
    },

    async endFork(forkId) {
      await deps.orchestrator.deleteFork(forkId);
      emit({ type: EventType.ForkCompleted, forkId });
    },

    async resolveIdentity(forkId) {
      const fork = await deps.orchestrator.getFork(forkId);
      if (!fork) return null;
      return {
        forkId,
        parentAgentId: fork.agentId,
        foreignSub: fork.foreignSub,
        podIP: fork.status?.podIP ?? null,
      };
    },

    async listByAgent(agentId) {
      const forks = await deps.orchestrator.listForks({ agentId });
      return forks.map(toSummary);
    },

    async listByReplier(foreignSub) {
      const forks = await deps.orchestrator.listForks();
      return forks.filter((f) => f.foreignSub === foreignSub).map(toSummary);
    },

    async pokeCredentials(foreignSub) {
      const forks = await deps.orchestrator.listForks();
      await Promise.all(
        forks
          .filter((f) => f.foreignSub === foreignSub)
          .map((f) => deps.orchestrator.bumpCredentialsRev(f.forkId)),
      );
    },
  };
}

function toSummary(f: {
  forkId: string;
  agentId: string;
  foreignSub: string;
  status: { phase: ForkPhase; podIP?: string } | null;
  lastActivityAt: string | null;
}) {
  const phase = f.status?.phase ?? null;
  return {
    forkId: f.forkId,
    parentAgentId: f.agentId,
    foreignSub: f.foreignSub,
    phase,
    // Pending counts as running: its Job exists, so it is already
    // reserving budget.
    podRunning: phase === "Ready" || phase === "Pending",
    lastActivityAt: f.lastActivityAt,
  };
}
