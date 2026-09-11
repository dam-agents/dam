import { readdir } from "node:fs/promises";
import type { Db } from "db";
import type { AgentStore } from "../agents/infrastructure/agent-store.js";
import type { SecretStore } from "../secret-store/index.js";
import { createRunscPort } from "./infrastructure/runsc-port.js";
import { createImageStore } from "./infrastructure/image-store.js";
import { createEnvoyConfigPort } from "./infrastructure/envoy-config-port.js";
import { createGatewayPort } from "./infrastructure/gateway-port.js";
import { createNetworkPort } from "./infrastructure/network-port.js";
import type { PkiPort } from "./infrastructure/pki-port.js";
import { createAgentRegistryAuthPort } from "../agents/infrastructure/agent-registry-auth-port.js";
import type { EnvoyOTelView } from "./domain/envoy-bootstrap.js";
import {
  createSandboxSupervisor,
  type SandboxSupervisorDeps,
  type SandboxSupervisor,
} from "./services/sandbox-supervisor.js";

export interface SandboxesModule {
  supervisor: SandboxSupervisor;
}

export function composeSandboxes(deps: {
  db: Db;
  store: AgentStore;
  secrets: SecretStore;
  sockets: {
    open(agentId: string): Promise<void>;
    close(agentId: string): Promise<void>;
  };
  agentsRoot: string;
  runRoot: string;
  imagesRoot: string;
  pkiRoot: string;
  gatewayPort: number;
  sandboxPort: number;
  gatewayUid: number;
  gatewayGid: number;
  defaultIdleTimeoutMs: number;
  nodeId: string;
  pki: PkiPort;
  fetchWorkspace: SandboxSupervisorDeps["fetchWorkspace"];
  sandboxCommand: string[];
  harnessBaseUrl: string;
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
    runsc: createRunscPort({
      images: createImageStore({ root: deps.imagesRoot, log: deps.log }),
      log: deps.log,
    }),
    gateway: createGatewayPort({ log: (message) => deps.log(message) }),
    pki: deps.pki,
    registryAuth: createAgentRegistryAuthPort(deps.secrets),
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
    nodeId: deps.nodeId,
    fetchWorkspace: deps.fetchWorkspace,
    directories: () => readdir(deps.agentsRoot).catch(() => [] as string[]),
    sandboxCommand: deps.sandboxCommand,
    harnessBaseUrl: deps.harnessBaseUrl,
    log: deps.log,
  });
  return { supervisor };
}
