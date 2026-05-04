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
import type { K8sAllowOnlySecretsPort } from "./infrastructure/k8s-allow-only-secrets-port.js";

export interface ComposeEgressRulesDeps {
  db: Db;
  ownerSub: string;
  isAgentOwnedBy: (agentId: string, ownerSub: string) => Promise<boolean>;
  /** Materializes allow-only Secrets that promote a host onto Envoy's L7
   *  chain. Optional — non-cluster contexts (tests) skip the side effect. */
  allowOnlySecrets?: K8sAllowOnlySecretsPort;
  /** Bulk-seeder used by `applyPreset`. The application root owns the
   *  trusted-host list (loaded once from the helm-mounted ConfigMap) and
   *  passes the seeder in so this module doesn't need filesystem access. */
  presetSeeder?: PresetSeeder;
  /** Same list the seeder uses. Surfaced through the service so the UI can
   *  preview a trusted-preset switch before committing. */
  trustedHosts: readonly string[];
}

export function composeEgressRulesModule(deps: ComposeEgressRulesDeps): {
  service: EgressRulesService;
} {
  const repo = createEgressRulesRepository(deps.db);
  const service = createEgressRulesService({
    repo,
    allowOnlySecrets: deps.allowOnlySecrets,
    presetSeeder: deps.presetSeeder,
    trustedHosts: deps.trustedHosts,
    isAgentOwnedBy: deps.isAgentOwnedBy,
    ownerSub: deps.ownerSub,
  });
  return { service };
}

/**
 * System-level read adapter consumed by the approvals module's ext_authz
 * gate on the egress hot path. Stateless and not owner-scoped — owner
 * scoping is structural via the agent ConfigMap, not a per-query filter.
 */
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

/**
 * System-level write adapter consumed by the approvals module's
 * approve-permanent / deny-forever paths. Narrow port — only `insert`,
 * matching the `EgressRuleWriter` interface declared on the consumer side.
 */
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
  }): Promise<void>;
}

export function createEgressRuleWriterAdapter(db: Db): EgressRuleWriterAdapter {
  const repo = createEgressRulesRepository(db);
  return {
    async insert(input) {
      await repo.insert(input);
    },
  };
}

/**
 * System-level preset-seeder, called from the agent-create flow.
 * `trustedHosts` is loaded once at boot from the helm-mounted ConfigMap
 * and passed in here — the seeder is a thin function that translates
 * `(agentId, preset)` into a batch of inserts.
 */
/**
 * Returns a `PresetSeeder`-shaped adapter (structurally compatible with
 * the locally-declared port in the agents module). The application root
 * passes this to `composeAgentsModule` — neither module imports the other.
 */
export function createPresetSeederAdapter(db: Db, trustedHosts: readonly string[]) {
  const repo = createEgressRulesRepository(db);
  return createPresetSeeder({ repo, trustedHosts });
}

export type { ConnectionRulesSync } from "./services/connection-rules-sync.js";
export type { EgressPreset };
export {
  createK8sAllowOnlySecretsPort,
  type K8sAllowOnlySecretsPort,
} from "./infrastructure/k8s-allow-only-secrets-port.js";

/**
 * System-level connection-rules sync, called from the secrets module's
 * setAgentAccess flow. The egress-rules module owns the diff/insert/revoke
 * logic; the secrets module hands over the desired (agent, granted) state.
 */
export function createConnectionRulesSyncAdapter(db: Db): ConnectionRulesSync {
  const repo = createEgressRulesRepository(db);
  return createConnectionRulesSync({ repo });
}

/**
 * Per-agent cleanup hook registered with `composeAgentsModule`. Hard-deletes
 * every egress_rules row for the agent — both active and revoked — once the
 * agent ConfigMap is gone. Best-effort: throws on DB error and the agents
 * service logs + continues with remaining hooks.
 */
export function createEgressRulesCleanupHook(db: Db): (agentId: string) => Promise<void> {
  const repo = createEgressRulesRepository(db);
  return (agentId) => repo.deleteForAgent(agentId);
}

/**
 * Read primitive used by the orphan sweeper saga to find agent_ids the DB
 * still references that no longer have a live K8s ConfigMap.
 */
export function listEgressRuleAgentIds(db: Db): Promise<string[]> {
  return createEgressRulesRepository(db).listDistinctAgentIds();
}
