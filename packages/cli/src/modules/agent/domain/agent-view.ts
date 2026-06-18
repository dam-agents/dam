import type { ChannelConfig, EnvVar, AgentState } from "api-server-api";

/**
 * Wire shape the api-server's `agents.*` router emits via `toView`. The
 * canonical `Agent` interface nests definition fields under
 * `spec`, but the router intentionally returns a flattened view so older
 * consumers don't have to re-thread through `spec`. The CLI consumes the
 * router's wire shape, so this is the type it reasons about.
 */
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
  allowedUserEmails: string[];
}
