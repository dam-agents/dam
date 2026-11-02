import type {
  AgentDefaultProvider,
  AgentState,
  ChannelConfig,
  EnvVar,
} from "api-server-api";

export interface AgentView {
  id: string;
  name: string;
  templateId: string | null;
  image: string;
  description?: string;
  avatar?: string | null;
  env?: EnvVar[];
  state: AgentState;
  disabled?: boolean;
  error?: string;
  overBudgetMessage?: string;
  podTerminationReason?: string;
  podTerminationCode?: string;
  channels: ChannelConfig[];
  starterKit?: string | null;
  defaultProvider?: AgentDefaultProvider;
}

export function displayState(agent: AgentView): string {
  return agent.disabled ? "disabled" : agent.state;
}

export function defaultProviderLine(
  { connectionId, profile }: AgentDefaultProvider,
  name: string | undefined,
): string {
  const provider = name ? `${name} (${connectionId})` : connectionId;
  return profile
    ? `  Provider: ${provider}, from your default for new agents, profile "${profile.name}": ${profile.model} on ${profile.harness}. Change that default in Settings › Providers › Profiles, or pass --provider.`
    : `  Provider: ${provider}, the first of yours its harness runs on; your default for new agents does not apply to it.`;
}
