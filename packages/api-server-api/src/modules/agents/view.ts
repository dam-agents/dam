import type { Agent } from "./types.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The agents a caller sees when it lists agents:
 * those its key is bound to, without Environments. An Environment is its own
 * kind of thing under its Owning Agent, never an agent in a list, a picker or
 * a count, on any surface that lists agents (the app, the CLI, an API key's
 * agent picker); it is still found by id, as its own page and its relays need.
 */
export function listedAgents(
  agents: Agent[],
  boundTo: "*" | readonly string[],
): Agent[] {
  return agents.filter(
    (agent) =>
      !agent.spec.environmentOf &&
      (boundTo === "*" || boundTo.includes(agent.id)),
  );
}

export function toAgentView(agent: Agent, spawnedBy: string | null = null) {
  return {
    spawnedBy,
    environmentOf: agent.spec.environmentOf ?? null,
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
    podTerminationReason: agent.podTerminationReason,
    podTerminationCode: agent.podTerminationCode,
    notReadyMessage: agent.notReadyMessage,
    ...(agent.startFailure ? { startFailure: agent.startFailure } : {}),
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
    starterKit: agent.starterKit ?? null,
    starterKitOnboarded: agent.starterKitOnboarded ?? null,
    kitUpdatePending: agent.kitUpdatePending ?? null,
    ...(agent.onboardingSteps
      ? { onboardingSteps: agent.onboardingSteps }
      : {}),
  };
}
