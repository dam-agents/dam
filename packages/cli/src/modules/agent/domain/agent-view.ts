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

const PROVIDER_REASON: Partial<Record<AgentDefaultProvider["source"], string>> =
  {
    kit: "the first of the starter kit's providers you hold",
    template: "the first of its template's providers you hold",
  };

/* UNIT_BOUNDARY_DESCRIPTION: a server older than `source` answers without it; its profile, when present, still says the default chose, and anything else reads as the harness order, as it did before. */
export function defaultProviderLine(
  { connectionId, source, profile }: AgentDefaultProvider,
  name: string | undefined,
): string {
  const provider = name ? `${name} (${connectionId})` : connectionId;
  if (profile)
    return `  Provider: ${provider}, from your default for new agents, profile "${profile.name}": ${profile.model} on ${profile.harness}. Change that default in Settings › Providers › Profiles, or pass --provider.`;
  const why =
    PROVIDER_REASON[source] ?? "the first of yours its harness runs on";
  return `  Provider: ${provider}, ${why}; your default for new agents does not apply to it.`;
}
