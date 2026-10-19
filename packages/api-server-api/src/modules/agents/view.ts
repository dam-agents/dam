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
    harness: agent.spec.harness,
    description: agent.spec.description,
    avatar: agent.spec.avatar ?? null,
    env: agent.spec.env,
    hibernationTimeoutMin: agent.effectiveHibernationTimeoutMin,
    requireConnectionAddress: agent.spec.requireConnectionAddress === true,
    whisper: agent.spec.whispersOff !== true,
    grantedSecretIds: agent.spec.grantedSecretIds ?? [],
    grantedConnectionIds: agent.spec.grantedConnectionIds ?? [],
    state: agent.state,
    error: agent.error,
    stopRequested: agent.stopRequested,
    disabled: agent.disabled,
    overBudget: agent.overBudget,
    overBudgetMessage: agent.overBudgetMessage,
    ...(agent.reclaimed ? { reclaimed: agent.reclaimed } : {}),
    size: {
      cpu: agent.spec.resources?.limits?.cpu,
      memory: agent.spec.resources?.limits?.memory,
    },
    podTerminationReason: agent.podTerminationReason,
    podTerminationCode: agent.podTerminationCode,
    notReadyMessage: agent.notReadyMessage,
    podRestarts: agent.podRestarts,
    podRestartReason: agent.podRestartReason,
    gatewayFailure: agent.gatewayFailure,
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

const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);

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
    case "VmStorageInsufficient":
      return [
        `Moving this agent needs about ${gib(refusal.neededBytes)} GiB free on your VM storage — twice its home directory, one copy while it moves and one on its new disk — and ${gib(refusal.usableBytes - refusal.usedBytes)} GiB of ${gib(refusal.usableBytes)} GiB is free: request more storage, or move an agent with a smaller home directory`,
      ];
    case "VmMemoryInsufficient":
      return [
        `Your VM agents have committed ${gib(refusal.committedMiB * 1024 ** 2)} GiB of their ${gib(refusal.limitMiB * 1024 ** 2)} GiB of memory, leaving no room for another machine: pause or delete a VM agent, or request more memory`,
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
