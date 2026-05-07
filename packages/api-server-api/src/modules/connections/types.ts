import type { EnvMapping } from "../secrets/types.js";

export type AppConnectionStatus =
  | "connected"
  | "expired"
  | "disconnected"
  | "unknown";

export interface AppConnectionView {
  id: string;
  provider: string;
  label: string;
  status: AppConnectionStatus;
  identity?: string;
  scopes?: string[];
  connectedAt?: string;
  /**
   * Pod envs contributed by this connection. Declared by the OAuth app
   * registry's `flow.envMappings` and returned verbatim on
   * `GET /api/connections`.
   */
  envMappings?: EnvMapping[];
  /**
   * API hosts this provider needs to reach (ADR-035). Sourced server-side
   * from `OAuthAppDescriptor.egressHosts` for static apps, or from the
   * connection's stored host pattern for dynamic-host apps (Generic OAuth,
   * GitHub Enterprise). Granting the connection inserts one
   * `(host, *, *, allow, source=connection:<id>)` rule per host; ungranting
   * sweeps them. Empty / missing → grants don't produce egress rules.
   */
  egressHosts?: string[];
}

export interface AgentAppConnections {
  connectionIds: string[];
}

export interface ConnectionsService {
  list(): Promise<AppConnectionView[]>;
  getAgentConnections(agentId: string): Promise<AgentAppConnections>;
  setAgentConnections(agentId: string, connectionIds: string[]): Promise<void>;
}
