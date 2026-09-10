import { join } from "node:path";

/**
 * Where an agent's state lives on the node. Everything under `root/<id>`
 * belongs to one agent and is removed with it; what survives hibernation is
 * exactly what a PVC used to hold, which is `work` and `home`.
 */
export interface SandboxLayout {
  root: string;
  /** Persisted workspace — survives stop/start and image changes. */
  work: string;
  /** Persisted HOME — harness config, credentials the agent writes itself. */
  home: string;
  /** Scratch, removed when the sandbox stops. */
  scratch: string;
  /** Rendered Envoy bootstrap for the paired gateway. */
  gatewayConfig: string;
  /** Credential SDS files, readable only by the gateway's uid. */
  credentials: string;
  /** MITM leaf certificate and key for this agent's gateway. */
  leafTls: string;
  /** CA bundle the sandbox trusts, so the gateway can terminate its TLS. */
  caCert: string;
  /** Environment file the runtime reads at boot. */
  envFile: string;
}

export function layoutFor(root: string, agentId: string): SandboxLayout {
  const dir = join(root, agentId);
  return {
    root: dir,
    work: join(dir, "work"),
    home: join(dir, "home"),
    scratch: join(dir, "scratch"),
    gatewayConfig: join(dir, "gateway", "envoy.yaml"),
    credentials: join(dir, "gateway", "credentials"),
    leafTls: join(dir, "gateway", "tls"),
    caCert: join(dir, "ca", "ca.crt"),
    envFile: join(dir, "env"),
  };
}

/** Sockets the gateway reaches the api-server through. One pair per agent. */
export interface SandboxSockets {
  harness: string;
  extAuthz: string;
}

export function socketsFor(runRoot: string, agentId: string): SandboxSockets {
  return {
    harness: join(runRoot, "harness", `${agentId}.sock`),
    extAuthz: join(runRoot, "extauthz", `${agentId}.sock`),
  };
}
