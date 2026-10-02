import { TRPCError } from "@trpc/server";
import type { AgentsService } from "api-server-api";

import { securityLog } from "../../../core/security-log.js";
import { emit, EventType } from "../../../events.js";
import type { KitUpdateMarks } from "./kit-updates.js";

export interface KitUpdateReporter {
  report(agentId: string, owner: string, commit: string): Promise<void>;
  cancel(agentId: string, owner: string): Promise<void>;
}

export function createKitUpdateReporter(deps: {
  agentsFor: (owner: string) => Pick<AgentsService, "get">;
  marks: KitUpdateMarks;
}): KitUpdateReporter {
  async function pendingOf(agentId: string, owner: string) {
    const agent = await deps.agentsFor(owner).get(agentId);
    const pending = agent?.kitUpdatePending;
    const stamp = agent?.starterKitSeed;
    if (!pending || !stamp)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "no kit update is pending on this agent",
      });
    return { pending, stamp };
  }

  function announce(
    agentId: string,
    owner: string,
    event: string,
    target: string,
  ) {
    emit({ type: EventType.AgentUpdated, agentId, ownerSub: owner });
    securityLog("info", event, {
      category: "resource",
      actor: owner,
      actorKind: "agent",
      surface: "mcp",
      agentId,
      result: "success",
      target,
    });
  }

  return {
    async report(agentId, owner, commit) {
      const { pending, stamp } = await pendingOf(agentId, owner);
      if (commit.toLowerCase() !== pending.targetCommit.toLowerCase())
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `this update targets ${pending.targetCommit}, not ${commit}`,
        });
      await deps.marks.end(agentId, { ...stamp, commit: pending.targetCommit });
      announce(
        agentId,
        owner,
        "starter_kit.updated",
        `${stamp.url}@${pending.targetCommit}`,
      );
    },

    async cancel(agentId, owner) {
      const { stamp } = await pendingOf(agentId, owner);
      await deps.marks.end(agentId, null);
      announce(
        agentId,
        owner,
        "starter_kit.update_cancelled",
        `${stamp.url}@${stamp.commit}`,
      );
    },
  };
}
