import { randomUUID } from "node:crypto";
import type {
  EgressPreset,
  EgressRuleCreateInput,
  EgressRuleUpdateInput,
  EgressRuleView,
  EgressRulesService,
} from "api-server-api";
import type { EgressRulesRepository } from "../infrastructure/egress-rules-repository.js";
import type { EgressRuleRow } from "../domain/types.js";
import type { K8sAllowOnlySecretsPort } from "../infrastructure/k8s-allow-only-secrets-port.js";
import type { PresetSeeder } from "./preset-seeder.js";

export interface CreateEgressRulesServiceDeps {
  repo: EgressRulesRepository;
  /** Port that materializes the allow-only Secret which promotes a host
   *  onto Envoy's L7 chain. Optional so non-cluster contexts (tests) can
   *  skip the side effect. */
  allowOnlySecrets?: K8sAllowOnlySecretsPort;
  /** Bulk-seeder used by `applyPreset`. Optional so non-cluster contexts
   *  (tests) can skip preset operations. */
  presetSeeder?: PresetSeeder;
  /** Same list the seeder uses; surfaced so the UI can preview trusted
   *  rules without committing to a preset switch. */
  trustedHosts: readonly string[];
  isAgentOwnedBy(agentId: string, ownerSub: string): Promise<boolean>;
  ownerSub: string;
}

/** A rule needs the L7 (HTTP) ext_authz path — and therefore MITM — when
 *  it constrains method or path. Wildcard-only rules stay on the L4 path
 *  where the API server gates by SNI alone. */
function needsL7Promotion(method: string, pathPattern: string): boolean {
  return method !== "*" || pathPattern !== "*";
}

function toView(row: EgressRuleRow): EgressRuleView {
  return {
    id: row.id,
    agentId: row.agentId,
    host: row.host,
    method: row.method,
    pathPattern: row.pathPattern,
    verdict: row.verdict,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt.toISOString(),
    source: row.source,
  };
}

export function createEgressRulesService(
  deps: CreateEgressRulesServiceDeps,
): EgressRulesService {
  return {
    async listForAgent(agentId) {
      if (!(await deps.isAgentOwnedBy(agentId, deps.ownerSub))) return [];
      const rows = await deps.repo.listForAgent(agentId);
      return rows.map(toView);
    },

    async currentPreset(agentId) {
      if (!(await deps.isAgentOwnedBy(agentId, deps.ownerSub))) return "none";
      return deps.repo.getPresetForAgent(agentId);
    },

    async trustedHosts() {
      return deps.trustedHosts;
    },

    async create(input: EgressRuleCreateInput) {
      if (!(await deps.isAgentOwnedBy(input.agentId, deps.ownerSub))) {
        throw new Error("agent not found");
      }
      const row = await deps.repo.insert({
        id: randomUUID(),
        agentId: input.agentId,
        host: input.host,
        method: input.method,
        pathPattern: input.pathPattern,
        verdict: input.verdict,
        decidedBy: deps.ownerSub,
        source: "manual",
      });
      // Path-specific rules need MITM so the L7 ext_authz handler can see
      // method/path. The allow-only Secret is the controller's signal to
      // extend the cert SAN list and render an MITM chain. Idempotent: if
      // a credentialed Secret already exists for the host, this no-ops.
      if (
        needsL7Promotion(input.method, input.pathPattern) &&
        deps.allowOnlySecrets
      ) {
        await deps.allowOnlySecrets.ensure(deps.ownerSub, input.host);
      }
      return toView(row);
    },

    async update(input: EgressRuleUpdateInput) {
      const rule = await deps.repo.getById(input.id);
      if (!rule || !(await deps.isAgentOwnedBy(rule.agentId, deps.ownerSub))) {
        throw new Error("egress rule not found");
      }
      const updated = await deps.repo.updatePromoteToManual({
        id: input.id,
        method: input.method,
        pathPattern: input.pathPattern,
        verdict: input.verdict,
        decidedBy: deps.ownerSub,
      });
      if (!updated) throw new Error("egress rule not found");
      // The user may have just narrowed `(host, *, *)` to `(host, GET, /v1/x)`,
      // which promotes the host to L7 if it wasn't already. Same idempotent
      // ensure as create.
      if (
        needsL7Promotion(input.method, input.pathPattern) &&
        deps.allowOnlySecrets
      ) {
        await deps.allowOnlySecrets.ensure(deps.ownerSub, updated.host);
      }
      return toView(updated);
    },

    async revoke(id) {
      const rule = await deps.repo.getById(id);
      if (!rule || !(await deps.isAgentOwnedBy(rule.agentId, deps.ownerSub)))
        return;
      await deps.repo.revoke(id);
    },

    async applyPreset(agentId: string, preset: EgressPreset) {
      if (!(await deps.isAgentOwnedBy(agentId, deps.ownerSub))) {
        throw new Error("agent not found");
      }
      if (!deps.presetSeeder) return;
      // The seeder sweeps prior `preset:*` rows before inserting the new
      // ones, so switching presets replaces rather than piles up. Manual
      // and connection-derived rows are untouched.
      await deps.presetSeeder.seed(agentId, preset, deps.ownerSub);
    },
  };
}
