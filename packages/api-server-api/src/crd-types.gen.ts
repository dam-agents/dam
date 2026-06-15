/* Code generated from the agent-platform.ai CRDs by `mise run api-server-api:gen:crd-types`. DO NOT EDIT. */

/**
 * AgentSpec is the desired state of an Agent — the sole durable per-agent
 * resource after ADR-046 collapsed Instance into Agent. The api-server is the
 * sole writer.
 *
 * There is no desiredState field: running-vs-hibernated is not stored intent
 * but observed status the controller derives from activity (ADR-058). Security
 * context and scheduling are chart-only (config.AgentBase) and cannot be set
 * here by design.
 */
export interface AgentSpecCR {
  /**
   * AgentHome is the resolved HOME inside the agent container. Any $HOME
   * literals in Mounts are already resolved against it at write
   * time, so the controller never sees $HOME.
   */
  agentHome?: string;
  /**
   * Description is an optional human-readable description.
   */
  description?: string;
  /**
   * Env are plain environment variables projected into the agent container.
   */
  env?: {
    name: string;
    value: string;
  }[];
  /**
   * GrantedConnectionIDs are the connection IDs granted to this agent.
   */
  grantedConnectionIds?: string[];
  /**
   * GrantedSecretIDs are the credential Secret IDs granted to this agent's
   * egress — intent written by the api-server. ADR-058 moved these from a
   * ConfigMap annotation into spec, because they are reconciled by the
   * controller into the credential set mounted on the gateway.
   */
  grantedSecretIds?: string[];
  /**
   * Image is the agent container image.
   */
  image: string;
  /**
   * ImagePullPolicy overrides the chart-wide default; empty = inherit.
   */
  imagePullPolicy?: string;
  /**
   * ImagePullSecretRef names a kubernetes.io/dockerconfigjson Secret the
   * kubelet uses to pull the agent image from a private registry. Unlike
   * SecretRef it is never projected into the agent container — only the
   * kubelet consumes it at pod creation, so a foreign-replier fork can pull
   * with it without ever seeing it. When set it takes precedence over the
   * install-wide default pull secret, which is retained as a fallback.
   */
  imagePullSecretRef?: string;
  /**
   * Init is an optional one-shot init script run before the agent starts.
   */
  init?: string;
  /**
   * Mounts declares the agent's volumes; a persisted mount becomes a PVC.
   */
  mounts?: {
    /**
     * Path is the absolute mount path inside the container.
     */
    path: string;
    /**
     * Persist marks the mount as backed by a retained PVC rather than an
     * emptyDir that dies with the pod.
     */
    persist: boolean;
    /**
     * Size is an optional K8s resource Quantity (e.g. "2Gi") for a persisted
     * mount's PVC. Empty falls back to StorageSize, then the chart default.
     * Ignored when Persist is false.
     */
    size?: string;
  }[];
  /**
   * Name is an optional human-readable name.
   */
  name?: string;
  /**
   * Resources are the agent container's resource requests and limits.
   */
  resources?: {
    limits?: {
      [k: string]: string;
    };
    requests?: {
      [k: string]: string;
    };
  };
  /**
   * SecretRef names a K8s Secret whose keys are envFrom-projected into the
   * agent container (operator-supplied envs).
   */
  secretRef?: string;
  /**
   * StorageSize overrides the chart-wide default PVC size; empty = inherit.
   */
  storageSize?: string;
}

/**
 * ForkSpec is the per-turn ephemeral runtime that derives from an Agent
 * (ADR-046: Forks survived the Instance/Agent collapse). The parent Agent's
 * egress surface scopes what the fork can reach. The api-server is the sole
 * writer.
 */
export interface ForkSpecCR {
  /**
   * AgentName names the parent Agent this fork impersonates.
   */
  agentName: string;
  /**
   * ForeignSub is the foreign user identity the fork runs as.
   */
  foreignSub: string;
  /**
   * SessionID is the optional originating session.
   */
  sessionId?: string;
}
