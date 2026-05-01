import type {
  Instance,
  InstanceState,
  ChannelConfig,
} from "api-server-api";

export interface InfraInstance {
  id: string;
  name: string;
  agentId: string;
  description?: string;
  desiredState: "running" | "hibernated";
  currentState?: "running" | "hibernated" | "error";
  error?: string;
  podReady: boolean;
  experimentalCredentialInjector?: boolean;
}

export function computeState(infra: InfraInstance): InstanceState {
  if (infra.currentState === "error") return "error";
  if (infra.desiredState === "running" && infra.currentState !== "running") return "starting";
  if (infra.desiredState === "hibernated" && infra.currentState === "running") return "hibernating";
  if (infra.desiredState === "hibernated") return "hibernated";
  if (!infra.podReady) return "starting";
  return "running";
}

export function assembleInstance(
  infra: InfraInstance,
  channels: ChannelConfig[],
  allowedUserEmails: string[] = [],
): Instance {
  return {
    id: infra.id,
    name: infra.name,
    agentId: infra.agentId,
    description: infra.description,
    state: computeState(infra),
    error: infra.currentState === "error" ? infra.error : undefined,
    channels,
    allowedUserEmails,
    experimentalCredentialInjector: infra.experimentalCredentialInjector,
  };
}

export function findOrphanedInstanceIds(
  infraIds: Set<string>,
  psqlInstanceIds: string[],
): string[] {
  return psqlInstanceIds.filter((id) => !infraIds.has(id));
}
