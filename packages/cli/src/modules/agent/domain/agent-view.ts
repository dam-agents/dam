import type { ChannelConfig, EnvVar, AgentState } from "api-server-api";

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
}

export function displayState(agent: AgentView): string {
  return agent.disabled ? "disabled" : agent.state;
}
