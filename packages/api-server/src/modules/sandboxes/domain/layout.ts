import { join } from "node:path";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Where one agent's state lives on the node.
 * Everything under the agent's directory belongs to it and goes when it is
 * deleted; what survives hibernation is exactly `home`.
 */
export interface SandboxLayout {
  root: string;
  home: string;
  gatewayConfig: string;
  credentials: string;
  leafTls: string;
  caCert: string;
  sandbox: string;
  registryAuth: string;
}

export function layoutFor(root: string, agentId: string): SandboxLayout {
  const dir = join(root, agentId);
  return {
    root: dir,
    home: join(dir, "home"),
    gatewayConfig: join(dir, "gateway", "envoy.yaml"),
    credentials: join(dir, "gateway", "credentials"),
    leafTls: join(dir, "gateway", "tls"),
    caCert: join(dir, "ca", "ca.crt"),
    sandbox: join(dir, "sandbox"),
    registryAuth: join(dir, "registry-auth"),
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
