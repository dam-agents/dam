/**
 * AgentSpecCR is the desired state of an Agent — the sole durable per-agent
 * record. The api-server is the sole writer; the sandbox supervisor reads it
 * and never writes it.
 *
 * There is no desiredState field: running-vs-hibernated is not stored intent
 * but observed status the supervisor derives from activity. Node-wide policy
 * (sandbox security profile, image pull defaults, hibernation default) lives
 * in the node config, not here.
 */
export interface AgentSpecCR {
  /**
   * AgentHome is the resolved HOME inside the sandbox. Any $HOME literals in
   * Mounts are already resolved against it at write time, so the supervisor
   * never sees $HOME.
   */
  agentHome?: string;
  /** Optional human-readable description. */
  description?: string;
  /** Plain environment variables set on the sandbox process. */
  env?: {
    name: string;
    value: string;
  }[];
  /** Connection IDs granted to this agent. */
  grantedConnectionIds?: string[];
  /**
   * Credential Secret IDs granted to this agent's egress — intent written by
   * the api-server. The supervisor renders them into the paired gateway's
   * credential set; they never reach the sandbox.
   */
  grantedSecretIds?: string[];
  /**
   * Overrides the node-wide idle timeout for this Agent: "0s" never
   * hibernates, omitted inherits the default. The UI writes it (presented in
   * minutes); the supervisor and api-server resolve the effective value.
   */
  hibernationTimeout?: string;
  /** The agent image, run under gVisor. */
  image: string;
  /** `always` | `missing` | `never`; empty inherits the node default. */
  imagePullPolicy?: string;
  /**
   * Directory holding a docker `config.json` the image pull authenticates
   * with, for an image in a private registry. It is read by the pull and
   * never mounted into the sandbox. When set it takes precedence over the
   * node-wide default registry auth, which is retained as a fallback.
   */
  registryAuthPath?: string;
  /** Optional one-shot init script run before the agent starts. */
  init?: string;
  /**
   * Hosts promoted onto the gateway's TLS-terminating (L7) interception
   * chain without a credential, so path/method/port egress rules are
   * enforceable over HTTPS — the L4 catch-all sees only SNI. Written by the
   * api-server when such a rule exists for this agent; per-agent grain so a
   * rule on one agent never reshapes a sibling's gateway. Run executors
   * inherit the parent agent's L7Hosts (the parent owner stays the egress
   * policy authority for foreign turns).
   *
   * The item pattern is a hard boundary: each entry is interpolated into the
   * gateway's Envoy bootstrap and into the leaf certificate's SANs, so
   * admission rejects anything that isn't a DNS hostname (optionally a `*.`
   * wildcard) — no quotes, whitespace, or YAML metacharacters can reach the
   * rendered config.
   *
   * @maxItems 256
   */
  l7Hosts?: string[];
  /**
   * The sandbox's volumes. A persisted mount is a directory on the node that
   * outlives the sandbox; anything else is scratch that dies with it.
   */
  mounts?: {
    /** Absolute mount path inside the sandbox. */
    path: string;
    /** Backed by a retained node directory rather than scratch space. */
    persist: boolean;
  }[];
  /** Optional human-readable name. */
  name?: string;
  /** The sandbox's resource requests and limits. */
  resources?: {
    limits?: {
      [k: string]: string;
    };
    requests?: {
      [k: string]: string;
    };
  };
  /**
   * Names a credential-store entry whose fields become environment variables
   * on the sandbox (operator-supplied envs). Unlike granted credentials these
   * are visible to the agent by design.
   */
  secretRef?: string;
  /**
   * The agent id stamped as the trusted telemetry attribution
   * (`x-platform-agent-id`) instead of this agent's own id. Set by the
   * api-server for Invocation targets to their root Driver, so a target's
   * spend credits the agent that drove it rather than the short-lived target.
   * When set, the gateway also stamps `x-platform-invocation-id` with this
   * agent's own id, keeping child rows distinguishable after their
   * attribution is merged. Never user-settable — a user-supplied value would
   * forge attribution onto an agent the caller does not drive; it is
   * service-only input, like the pre-minted id.
   */
  telemetryAttributionId?: string;
}
