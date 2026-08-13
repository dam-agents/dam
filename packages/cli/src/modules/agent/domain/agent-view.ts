import type { ChannelConfig, EnvVar, AgentState } from "api-server-api";

export interface AgentView {
  id: string;
  name: string;
  templateId: string | null;
  image: string;
  description?: string;
  env?: EnvVar[];
  state: AgentState;
  error?: string;
  channels: ChannelConfig[];
}
