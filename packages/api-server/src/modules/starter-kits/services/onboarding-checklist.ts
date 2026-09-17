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

/**
 * UNIT_BOUNDARY_DESCRIPTION: The checklist a kit agent reports while its
 * onboarding is pending. Only such an agent may write one: a plain agent has
 * no onboarding, and one already stamped complete has nothing left to report,
 * so a stale session's call is refused rather than reopening a finished
 * onboarding. Every write raises the same agent-change hint the completion
 * stamp does, so the tag and the chat bar move as the agent works.
 */
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
  const save = async (agentId: string, steps: OnboardingStep[]) => {
    await deps.repo.write(agentId, steps);
    emit({ type: EventType.AgentUpdated, agentId });
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
      return save(
        agentId,
        replaceChecklist(await deps.repo.read(agentId), steps),
      );
    },
    async complete(agentId, id) {
      await pending(agentId);
      const next = completeStep((await deps.repo.read(agentId)) ?? [], id);
      if (next === null)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `no onboarding step "${id}" — set the checklist first`,
        });
      return save(agentId, next);
    },
  };
}
