import type { Agent } from "./types.js";

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
    env: agent.spec.env,
    hibernationTimeoutMin: agent.effectiveHibernationTimeoutMin,
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
    contributionFailures: agent.contributionFailures,
    unsupportedContributionKinds: agent.unsupportedContributionKinds,
    workspaceFailures: agent.workspaceFailures,
    channels: agent.channels,
    kind: agent.kind,
    kbTemplateId: agent.kbTemplateId ?? null,
    ...(agent.kbShareRoots ? { kbShareRoots: agent.kbShareRoots } : {}),
    vm: agent.spec.backend?.type === "vm",
    starterKit: agent.starterKit ?? null,
    starterKitOnboarded: agent.starterKitOnboarded ?? null,
    ...(agent.onboardingSteps
      ? { onboardingSteps: agent.onboardingSteps }
      : {}),
  };
}
