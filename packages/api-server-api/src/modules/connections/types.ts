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
   * Pod envs contributed by this connection. Declared by OneCLI's app
   * registry (see the matching `AppDefinition.envMappings` field) and
   * returned verbatim on `GET /api/connections` — Humr never writes this.
   */
  envMappings?: EnvMapping[];
  /**
   * API hosts this provider needs to reach (ADR-035). Joined
   * server-side from the operator-owned `appConnectionEgressHosts` ConfigMap
   * keyed by `provider`. Granting the connection inserts one
   * `(host, *, *, allow, source=connection:<id>)` rule per host; ungranting
   * sweeps them. Empty / missing → grants don't produce egress rules
   * (some providers' hosts haven't been declared yet).
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
