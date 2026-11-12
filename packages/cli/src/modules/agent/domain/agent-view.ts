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
  access?: { editors: readonly string[] };
}

export function displayState(agent: AgentView): string {
  return agent.disabled ? "disabled" : agent.state;
}

const HARNESS_ORDER = "the first of yours its harness runs on";
/* UNIT_BOUNDARY_DESCRIPTION: one reason per source; `profile` reaches this table only without its profile, which no server sends. */
const PROVIDER_REASON: Record<AgentDefaultProvider["source"], string> = {
  profile: HARNESS_ORDER,
  kit: "the first of the starter kit's providers you hold",
  template: "the first of its template's providers you hold",
  harness: HARNESS_ORDER,
};

/* UNIT_BOUNDARY_DESCRIPTION: a server older than `source` answers without it; its profile, when present, still says the default chose, and anything else reads as the harness order, as it did before. */
export function defaultProviderLine(
  { connectionId, source, profile }: AgentDefaultProvider,
  name: string | undefined,
): string {
  const provider = name ? `${name} (${connectionId})` : connectionId;
  if (profile)
    return `  Provider: ${provider}, from your default for new agents, profile "${profile.name}": ${profile.model} on ${profile.harness}. Change that default in Settings › Providers › Profiles, or pass --provider.`;
  const why = PROVIDER_REASON[source] ?? HARNESS_ORDER;
  return `  Provider: ${provider}, ${why}; your default for new agents does not apply to it.`;
}
