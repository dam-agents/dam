import { TRPCError } from "@trpc/server";
import type { AgentsService, OnboardingStep } from "api-server-api";
import { emit, EventType } from "../../../events.js";
import {
  completeStep,
  duplicateStepId,
  type OnboardingStepInput,
  replaceChecklist,
} from "../domain/onboarding-checklist.js";
import type { OnboardingChecklistRepository } from "../infrastructure/onboarding-checklist-repository.js";

export interface OnboardingChecklistDeps {
  agents: Pick<AgentsService, "get">;
  repo: OnboardingChecklistRepository;
  ownerSub: string;
}

export interface OnboardingChecklist {
  set: (
    agentId: string,
    steps: readonly OnboardingStepInput[],
  ) => Promise<OnboardingStep[]>;
  complete: (agentId: string, id: string) => Promise<OnboardingStep[]>;
}

export interface OnboardingChecklistOps {
  set: (
    agentId: string,
    owner: string,
    steps: readonly OnboardingStepInput[],
  ) => Promise<OnboardingStep[]>;
  complete: (
    agentId: string,
    owner: string,
    id: string,
  ) => Promise<OnboardingStep[]>;
}

export function createOnboardingChecklist(
  deps: OnboardingChecklistDeps,
): OnboardingChecklist {
  const pending = async (agentId: string) => {
    const agent = await deps.agents.get(agentId);
    if (!agent?.starterKit)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "this agent was not created from a starter kit",
      });
    if (agent.starterKitOnboarded)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "onboarding is already complete on this agent",
      });
  };
  const announce = (agentId: string, steps: OnboardingStep[]) => {
    emit({ type: EventType.AgentUpdated, agentId, ownerSub: deps.ownerSub });
    return steps;
  };
  return {
    async set(agentId, steps) {
      await pending(agentId);
      const duplicate = duplicateStepId(steps);
      if (duplicate !== null)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `onboarding step id "${duplicate}" is used twice`,
        });
      return announce(
        agentId,
        await deps.repo.update(agentId, (current) =>
          replaceChecklist(current, steps),
        ),
      );
    },
    async complete(agentId, id) {
      await pending(agentId);
      const next = await deps.repo.update(agentId, (current) =>
        completeStep(current ?? [], id),
      );
      if (next === null)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `no onboarding step "${id}" — set the checklist first`,
        });
      return announce(agentId, next);
    },
  };
}
