import type { Db } from "db";
import type { EgressRulesService } from "api-server-api";
import { createEgressRulesRepository } from "./infrastructure/egress-rules-repository.js";
import {
  createEgressRulesService,
  type CreateEgressRulesServiceDeps,
} from "./services/egress-rules-service.js";
import { createPresetSeeder } from "./services/preset-seeder.js";
import {
  createConnectionRulesSync,
  type ConnectionRulesSync,
} from "./services/connection-rules-sync.js";
import { createEgressRuleWriter } from "./services/egress-rule-writer.js";
import { createAgentL7HostsPort } from "./infrastructure/k8s-agent-l7-hosts-port.js";
import type { AgentL7HostsPort } from "./infrastructure/k8s-agent-l7-hosts-port.js";
import { reconcileL7Promotions } from "./services/l7-promotion-reconcile.js";
import type { K8sClient } from "../agents/infrastructure/k8s.js";
import { AGENTS_PLURAL } from "../agents/infrastructure/labels.js";

export function composeEgressRulesModule(
  deps: Omit<CreateEgressRulesServiceDeps, "repo"> & { db: Db },
): {
  service: EgressRulesService;
} {
  const { db, ...serviceDeps } = deps;
  return {
    service: createEgressRulesService({
      ...serviceDeps,
      repo: createEgressRulesRepository(db),
    }),
  };
}

export function createEgressRuleMatchAdapter(db: Db) {
  const repo = createEgressRulesRepository(db);
  return {
    async match(agentId: string, host: string, method: string, path: string) {
      const row = await repo.findMatch(agentId, host, method, path);
      return row ? { verdict: row.verdict } : null;
    },
  };
}

export function createEgressRuleWriterAdapter(
  db: Db,
  l7Hosts: AgentL7HostsPort,
) {
  return createEgressRuleWriter({
    repo: createEgressRulesRepository(db),
    l7Hosts,
  });
}

export function createPresetSeederAdapter(
  db: Db,
  trustedHosts: readonly string[],
) {
  const repo = createEgressRulesRepository(db);
  return createPresetSeeder({ repo, trustedHosts });
}

export function createL7PromotionReconcile(
  db: Db,
  k8sClient: K8sClient,
  log: (message: string) => void,
): () => Promise<{ scanned: number; drifted: number; failed: number }> {
  const repo = createEgressRulesRepository(db);
  const l7Hosts = createAgentL7HostsPort(k8sClient);
  const listAgentL7State = async () => {
    const agents = await k8sClient.listCustomObjects(AGENTS_PLURAL);
    return agents.flatMap((a) => {
      const id = a.metadata?.name;
      if (!id) return [];
      const spec = (a.spec ?? {}) as { l7Hosts?: string[] };
      return [{ agentId: id, current: spec.l7Hosts ?? [] }];
    });
  };
  return () => reconcileL7Promotions({ repo, listAgentL7State, l7Hosts, log });
}

export { createAgentL7HostsPort };

export function createConnectionRulesSyncAdapter(db: Db): ConnectionRulesSync {
  const repo = createEgressRulesRepository(db);
  return createConnectionRulesSync({ repo });
}

export function createEgressRulesCleanupHook(
  db: Db,
): (agentId: string) => Promise<void> {
  const repo = createEgressRulesRepository(db);
  return (agentId) => repo.deleteForAgent(agentId);
}

export function listEgressRuleAgentIds(db: Db): Promise<string[]> {
  return createEgressRulesRepository(db).listDistinctAgentIds();
}
