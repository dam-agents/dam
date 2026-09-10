/**
 * UNIT_BOUNDARY_DESCRIPTION: The desired state of an Agent, and the sole
 * durable per-agent definition. The api-server is its only writer; the
 * supervisor reads it and never writes it. There is no desired-state field:
 * running-versus-hibernated is derived from activity, not stored.
 */
export interface AgentSpecCR {
  agentHome?: string;
  description?: string;
  env?: {
    name: string;
    value: string;
  }[];
  grantedConnectionIds?: string[];
  grantedSecretIds?: string[];
  hibernationTimeout?: string;
  image: string;
  imagePullPolicy?: string;
  registryAuthPath?: string;
  init?: string;
  l7Hosts?: string[];
  mounts?: {
    path: string;
    persist: boolean;
  }[];
  name?: string;
  resources?: {
    limits?: {
      [k: string]: string;
    };
    requests?: {
      [k: string]: string;
    };
  };
  secretRef?: string;
  telemetryAttributionId?: string;
}
