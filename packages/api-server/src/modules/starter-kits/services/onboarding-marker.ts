import { TRPCError } from "@trpc/server";
import type { AgentsService } from "api-server-api";
import { securityLog } from "../../../core/security-log.js";
import { emit, EventType } from "../../../events.js";

export interface OnboardingMarkerDeps {
  agents: Pick<AgentsService, "get">;
  markAgentOnboarded: (agentId: string, at: string) => Promise<void>;
}

export type OnboardingMarker = (
  agentId: string,
  owner: string,
) => Promise<void>;

export function createOnboardingMarker(
  deps: OnboardingMarkerDeps,
): OnboardingMarker {
  return async (agentId, owner) => {
    const agent = await deps.agents.get(agentId);
    if (!agent?.starterKit)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "this agent was not created from a starter kit",
      });
    if (agent.starterKitOnboarded) return;
    await deps.markAgentOnboarded(agentId, new Date().toISOString());
    emit({ type: EventType.AgentUpdated, agentId, ownerSub: owner });
    securityLog("info", "starter_kit.onboarded", {
      category: "resource",
      actor: owner,
      actorKind: "agent",
      surface: "mcp",
      agentId,
      result: "success",
      target: agent.starterKit,
    });
  };
}
