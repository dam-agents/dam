import { join } from "node:path";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Where one agent's state lives on the node.
 * Everything under the agent's directory belongs to it and goes when it is
 * deleted; what survives hibernation is exactly `work` and `home`.
 */
export interface SandboxLayout {
  root: string;
  work: string;
  home: string;
  scratch: string;
  gatewayConfig: string;
  credentials: string;
  leafTls: string;
  caCert: string;
  envFile: string;
  sandbox: string;
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
    sandbox: join(dir, "sandbox"),
  };
}

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
