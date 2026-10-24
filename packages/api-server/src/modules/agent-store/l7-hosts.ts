import type { K8sClient } from "../agents/infrastructure/k8s.js";
import type { Db } from "db";
import { createAgentL7HostsPort } from "../egress-rules/infrastructure/k8s-agent-l7-hosts-port.js";
import type { AgentL7HostsPort } from "../egress-rules/infrastructure/k8s-agent-l7-hosts-port.js";
import { createControlAgentL7HostsPort } from "./l7-hosts-control.js";
import type { AgentStoreMode } from "./fence.js";

export { createControlAgentL7HostsPort } from "./l7-hosts-control.js";

export function createL7HostsPortFor(deps: {
  authority: AgentStoreMode;
  k8s: K8sClient;
  db: Db;
}): AgentL7HostsPort {
  return deps.authority === "postgres"
    ? createControlAgentL7HostsPort(deps.db)
    : createAgentL7HostsPort(deps.k8s);
}
