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
  { connectionId, source, profile }: AgentDefaultProvider,
  name: string | undefined,
): string {
  const provider = name ? `${name} (${connectionId})` : connectionId;
  if (source === "profile" && profile)
    return `  Provider: ${provider}, from your default for new agents, profile "${profile.name}": ${profile.model} on ${profile.harness}. Change that default in Settings › Providers › Profiles, or pass --provider.`;
  const why = {
    kit: "the first of the starter kit's providers you hold",
    template: "the first of its template's providers you hold",
    harness: "the first of yours its harness runs on",
    profile: "the first of yours its harness runs on",
  }[source];
  return `  Provider: ${provider}, ${why}; your default for new agents does not apply to it.`;
}
