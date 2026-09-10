import type { AgentStore } from "../agents/infrastructure/agent-store.js";
import type { SecretStore } from "../secret-store/index.js";
import { createContainerdPort } from "./infrastructure/containerd-port.js";
import { createEnvoyConfigPort } from "./infrastructure/envoy-config-port.js";
import { createGatewayPort } from "./infrastructure/gateway-port.js";
import { createNetworkPort } from "./infrastructure/network-port.js";
import { createPkiPort } from "./infrastructure/pki-port.js";
import type { EnvoyOTelView } from "./domain/envoy-bootstrap.js";
import {
  createSandboxSupervisor,
  type SandboxSupervisor,
} from "./services/sandbox-supervisor.js";

export interface SandboxesModule {
  supervisor: SandboxSupervisor;
}

export function composeSandboxes(deps: {
  store: AgentStore;
  secrets: SecretStore;
  sockets: {
    open(agentId: string): Promise<void>;
    close(agentId: string): Promise<void>;
  };
  agentsRoot: string;
  runRoot: string;
  pkiRoot: string;
  gatewayPort: number;
  sandboxPort: number;
  gatewayUid: number;
  gatewayGid: number;
  defaultIdleTimeoutMs: number;
  harnessAuthority: string;
  extAuthzHoldSeconds: number;
  objectStore?: { host: string; port: number };
  telemetry?: { host: string; port: number };
  otel: (agentId: string) => EnvoyOTelView;
  log: (message: string, fields?: Record<string, unknown>) => void;
}): SandboxesModule {
  const supervisor = createSandboxSupervisor({
    store: deps.store,
    network: createNetworkPort(),
    containerd: createContainerdPort({}),
    gateway: createGatewayPort({ log: (message) => deps.log(message) }),
    pki: createPkiPort(deps.pkiRoot),
    envoyConfig: createEnvoyConfigPort({
      secrets: deps.secrets,
      gatewayPort: deps.gatewayPort,
      harnessAuthority: deps.harnessAuthority,
      extAuthzHoldSeconds: deps.extAuthzHoldSeconds,
      ...(deps.objectStore ? { objectStore: deps.objectStore } : {}),
      ...(deps.telemetry ? { telemetry: deps.telemetry } : {}),
      otel: deps.otel,
      log: deps.log,
    }),
    sockets: deps.sockets,
    agentsRoot: deps.agentsRoot,
    runRoot: deps.runRoot,
    gatewayPort: deps.gatewayPort,
    sandboxPort: deps.sandboxPort,
    gatewayUid: deps.gatewayUid,
    gatewayGid: deps.gatewayGid,
    defaultIdleTimeoutMs: deps.defaultIdleTimeoutMs,
    log: deps.log,
  });
  return { supervisor };
}
