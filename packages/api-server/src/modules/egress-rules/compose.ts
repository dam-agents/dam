import type { Db } from "db";
import type {
  EgressPreset,
  EgressRuleSource,
  EgressRulesService,
  RuleVerdict,
} from "api-server-api";
import { createEgressRulesRepository } from "./infrastructure/egress-rules-repository.js";
import { createEgressRulesService } from "./services/egress-rules-service.js";
import { createPresetSeeder } from "./services/preset-seeder.js";
import type { PresetSeeder } from "./services/preset-seeder.js";
import {
  createConnectionRulesSync,
  type ConnectionRulesSync,
} from "./services/connection-rules-sync.js";
import { createEgressRuleWriter } from "./services/egress-rule-writer.js";
import type { EgressRuleWriteOutcome } from "./services/egress-rule-writer.js";
import { createAgentL7HostsPort } from "./infrastructure/k8s-agent-l7-hosts-port.js";
import type { AgentL7HostsPort } from "./infrastructure/k8s-agent-l7-hosts-port.js";
import { reconcileL7Promotions } from "./services/l7-promotion-reconcile.js";
import type { K8sClient } from "../agents/infrastructure/k8s.js";
import { AGENTS_PLURAL } from "../agents/infrastructure/labels.js";

export interface ComposeEgressRulesDeps {
  db: Db;
  ownerSub: string;
  isAgentOwnedBy: (agentId: string, ownerSub: string) => Promise<boolean>;
  l7Hosts?: AgentL7HostsPort;
  presetSeeder?: PresetSeeder;
  trustedHosts: readonly string[];
}

export function composeEgressRulesModule(deps: ComposeEgressRulesDeps): {
  service: EgressRulesService;
} {
  const repo = createEgressRulesRepository(deps.db);
  const service = createEgressRulesService({
    repo,
    l7Hosts: deps.l7Hosts,
    presetSeeder: deps.presetSeeder,
    trustedHosts: deps.trustedHosts,
    isAgentOwnedBy: deps.isAgentOwnedBy,
    ownerSub: deps.ownerSub,
  });
  return { service };
}

export interface EgressRuleMatchAdapter {
  match(
    agentId: string,
    host: string,
    method: string,
    path: string,
  ): Promise<{ verdict: RuleVerdict } | null>;
}

export function createEgressRuleMatchAdapter(db: Db): EgressRuleMatchAdapter {
  const repo = createEgressRulesRepository(db);
  return {
    async match(agentId, host, method, path) {
      const row = await repo.findMatch(agentId, host, method, path);
      return row ? { verdict: row.verdict } : null;
    },
  };
}

export interface EgressRuleWriterAdapter {
  insert(input: {
    id: string;
    agentId: string;
    host: string;
    method: string;
    pathPattern: string;
    verdict: RuleVerdict;
    decidedBy: string;
    source: EgressRuleSource;
  }): Promise<EgressRuleWriteOutcome>;
}

export function createEgressRuleWriterAdapter(
  db: Db,
  l7Hosts?: AgentL7HostsPort,
): EgressRuleWriterAdapter {
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

export type { ConnectionRulesSync } from "./services/connection-rules-sync.js";
export type { EgressPreset };
export {
  createAgentL7HostsPort,
  type AgentL7HostsPort,
} from "./infrastructure/k8s-agent-l7-hosts-port.js";

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
