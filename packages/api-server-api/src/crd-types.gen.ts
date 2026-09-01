/* Code generated from the agent-platform.ai CRDs by `mise run api-server-api:gen:crd-types`. DO NOT EDIT. */

export interface AgentSpecCR {
  agentHome?: string;
  backend?: {
    type: "container" | "vm";
    vm?: {};
  };
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
  imagePullSecretRef?: string;
  init?: string;
  /**
   * @maxItems 256
   */
  l7Hosts?: string[];
  mounts?: {
    path: string;
    persist: boolean;
    size?: string;
  }[];
  name?: string;
  nodeSelector?: {
    [k: string]: string;
  };
  resources?: {
    limits?: {
      [k: string]: string;
    };
    requests?: {
      [k: string]: string;
    };
  };
  runtimeClassName?: string;
  secretRef?: string;
  storageClass?: string;
  storageSize?: string;
  telemetryAttributionId?: string;
}
