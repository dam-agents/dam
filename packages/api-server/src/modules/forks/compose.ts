import { TRPCError } from "@trpc/server";
import type { ForksUiService, ForkView } from "api-server-api";
import {
  createForksService,
  type ForkSummary,
  type ForksService,
} from "./services/forks-service.js";
import { forkIdFor } from "./infrastructure/fork-id.js";
import type { ForkOrchestratorPort } from "./infrastructure/ports.js";

export function composeForksModule(deps: {
  orchestrator: ForkOrchestratorPort;
}): { forks: ForksService } {
  return {
    forks: createForksService({ orchestrator: deps.orchestrator, forkIdFor }),
  };
}

/**
 * Per-request, owner-scoped facade over the boot-level forks service for the
 * UI surfaces (#2843): the owner sees their agents' forks and can end them;
 * a replier sees (and can end) the forks acting as them — their budget
 * itemization. Unauthorized targets read as NOT_FOUND, never FORBIDDEN, so
 * the surface leaks no existence information.
 */
export function composeForksUiForUser(deps: {
  forks: ForksService;
  ownerSub: string;
  isAgentOwnedBy: (agentId: string, ownerSub: string) => Promise<boolean>;
}): { forksUi: ForksUiService } {
  const toView = (f: ForkSummary): ForkView => ({
    forkId: f.forkId,
    agentId: f.parentAgentId,
    replierSub: f.foreignSub,
    phase: f.phase,
    podRunning: f.podRunning,
    lastActivityAt: f.lastActivityAt,
  });
  return {
    forksUi: {
      async listByAgent(agentId) {
        if (!(await deps.isAgentOwnedBy(agentId, deps.ownerSub))) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return (await deps.forks.listByAgent(agentId)).map(toView);
      },
      async listMine() {
        return (await deps.forks.listByReplier(deps.ownerSub)).map(toView);
      },
      async end(forkId) {
        const fork = await deps.forks.resolveIdentity(forkId);
        if (!fork) return; // already gone — ending is idempotent
        const allowed =
          fork.foreignSub === deps.ownerSub ||
          (await deps.isAgentOwnedBy(fork.parentAgentId, deps.ownerSub));
        if (!allowed) throw new TRPCError({ code: "NOT_FOUND" });
        await deps.forks.endFork(forkId);
      },
    },
  };
}
