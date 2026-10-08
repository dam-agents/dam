import type {
  Agent,
  RuntimeMigrationPlan,
  RuntimeMigrationRefusal,
} from "./types.js";

export function toAgentView(agent: Agent, spawnedBy: string | null = null) {
  return {
    spawnedBy,
    id: agent.id,
    name: agent.name,
    createdAt: agent.createdAt,
    templateId: agent.templateId ?? null,
    templateUpdate: agent.templateUpdate ?? null,
    features: agent.features,
    image: agent.spec.image,
    description: agent.spec.description,
    avatar: agent.spec.avatar ?? null,
    env: agent.spec.env,
    hibernationTimeoutMin: agent.effectiveHibernationTimeoutMin,
    requireConnectionAddress: agent.spec.requireConnectionAddress === true,
    grantedSecretIds: agent.spec.grantedSecretIds ?? [],
    grantedConnectionIds: agent.spec.grantedConnectionIds ?? [],
    state: agent.state,
    error: agent.error,
    stopRequested: agent.stopRequested,
    overBudget: agent.overBudget,
    overBudgetMessage: agent.overBudgetMessage,
    size: {
      cpu: agent.spec.resources?.limits?.cpu,
      memory: agent.spec.resources?.limits?.memory,
    },
    podTerminationReason: agent.podTerminationReason,
    notReadyMessage: agent.notReadyMessage,
    podRestarts: agent.podRestarts,
    podRestartReason: agent.podRestartReason,
    contributionFailures: agent.contributionFailures,
    unsupportedContributionKinds: agent.unsupportedContributionKinds,
    workspaceFailures: agent.workspaceFailures,
    channels: agent.channels,
    kind: agent.kind,
    kbTemplateId: agent.kbTemplateId ?? null,
    ...(agent.kbShareRoots ? { kbShareRoots: agent.kbShareRoots } : {}),
    vm: agent.spec.backend?.type === "vm",
    runtimeMigration: agent.runtimeMigration ?? null,
    runtimeMigratable: agent.runtimeMigratable ?? false,
    starterKit: agent.starterKit ?? null,
    starterKitOnboarded: agent.starterKitOnboarded ?? null,
    kitUpdatePending: agent.kitUpdatePending ?? null,
    ...(agent.onboardingSteps
      ? { onboardingSteps: agent.onboardingSteps }
      : {}),
  };
}

// UNIT_BOUNDARY_DESCRIPTION: the words for why an agent cannot move to the new runtime, one sentence per reason. The plan shows them before the user asks, and the migrate mutation refuses with the same sentences, so the two never disagree.
export function runtimeMigrationRefusalReasons(
  refusal: RuntimeMigrationRefusal,
): string[] {
  switch (refusal.type) {
    case "AlreadyOnVm":
      return ["This agent already runs on the new runtime"];
    case "VirtualizationDisabled":
      return [
        "The new runtime is not enabled on this install (virtualization.enabled)",
      ];
    case "RuntimeMigrationInProgress":
      return ["This agent is already moving to the new runtime"];
    case "StorageMigrationInProgress":
      return [
        "This agent's storage is being migrated — try again once it finishes",
      ];
    case "PersistsUnmovablePaths":
      return refusal.paths.map((p) => `${p.path} cannot be moved: ${p.reason}`);
    case "HomeNotPersisted":
      return [
        "This agent does not keep its home directory, so there is nothing for the new runtime to carry over",
      ];
    case "ConcurrentUpdate":
      return [
        "This agent changed while the move was being requested — try again",
      ];
  }
}

export function toRuntimeMigrationPlanView(plan: RuntimeMigrationPlan) {
  return {
    unmovable: plan.unmovable,
    storageSize: plan.storageSize,
    storageResized: plan.storageResized,
    bootsSleepingAgent: plan.bootsSleepingAgent,
    retentionMs: plan.retentionMs,
    allowed: plan.refusal === null,
    refusal: plan.refusal
      ? {
          type: plan.refusal.type,
          reasons: runtimeMigrationRefusalReasons(plan.refusal),
        }
      : null,
  };
}
