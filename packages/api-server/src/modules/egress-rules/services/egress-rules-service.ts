import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
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
import { securityLog } from "../../../core/security-log.js";

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
        securityLog("warn", "authz.owner_mismatch", {
          category: "authz",
          actor: deps.ownerSub,
          actorKind: "user",
          agentId: input.agentId,
          decision: "deny",
          reason: "not-owner",
          detail: { surface: "egress-rule.create" },
        });
        throw new TRPCError({ code: "NOT_FOUND", message: "agent not found" });
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
      securityLog("info", "egress_rule.create", {
        category: "authz-list",
        actor: deps.ownerSub,
        actorKind: "user",
        agentId: input.agentId,
        target: input.host,
        decision: input.verdict,
        detail: {
          method: input.method,
          pathPattern: input.pathPattern,
          ruleId: row.id,
          source: "manual",
          ...(input.host === "*" &&
          input.method === "*" &&
          input.pathPattern === "*"
            ? { unrestricted: true }
            : {}),
        },
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
        if (rule) {
          securityLog("warn", "authz.owner_mismatch", {
            category: "authz",
            actor: deps.ownerSub,
            actorKind: "user",
            agentId: rule.agentId,
            decision: "deny",
            reason: "not-owner",
            detail: { surface: "egress-rule.update", ruleId: input.id },
          });
        }
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "egress rule not found",
        });
      }
      const method = input.method ?? rule.method;
      const pathPattern = input.pathPattern ?? rule.pathPattern;
      const verdict = input.verdict ?? rule.verdict;
      const updated = await deps.repo.updatePromoteToManual({
        id: input.id,
        method,
        pathPattern,
        verdict,
        decidedBy: deps.ownerSub,
      });
      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "egress rule not found",
        });
      }
      securityLog("info", "egress_rule.update", {
        category: "authz-list",
        actor: deps.ownerSub,
        actorKind: "user",
        agentId: updated.agentId,
        target: updated.host,
        decision: input.verdict,
        detail: {
          ruleId: input.id,
          method: input.method,
          pathPattern: input.pathPattern,
          priorVerdict: rule.verdict,
        },
      });
      // The user may have just narrowed `(host, *, *)` to `(host, GET, /v1/x)`,
      // which promotes the host to L7 if it wasn't already. Same idempotent
      // ensure as create.
      if (needsL7Promotion(method, pathPattern) && deps.allowOnlySecrets) {
        await deps.allowOnlySecrets.ensure(deps.ownerSub, updated.host);
      }
      return toView(updated);
    },

    async revoke(id) {
      const rule = await deps.repo.getById(id);
      if (!rule || !(await deps.isAgentOwnedBy(rule.agentId, deps.ownerSub)))
        return;
      await deps.repo.revoke(id);
      securityLog("info", "egress_rule.revoke", {
        category: "authz-list",
        actor: deps.ownerSub,
        actorKind: "user",
        agentId: rule.agentId,
        target: rule.host,
        detail: {
          ruleId: id,
          method: rule.method,
          pathPattern: rule.pathPattern,
        },
      });
    },

    async applyPreset(agentId: string, preset: EgressPreset) {
      if (!(await deps.isAgentOwnedBy(agentId, deps.ownerSub))) {
        securityLog("warn", "authz.owner_mismatch", {
          category: "authz",
          actor: deps.ownerSub,
          actorKind: "user",
          agentId,
          decision: "deny",
          reason: "not-owner",
          detail: { surface: "egress-rule.preset" },
        });
        throw new TRPCError({ code: "NOT_FOUND", message: "agent not found" });
      }
      if (!deps.presetSeeder) return;
      // The seeder sweeps prior `preset:*` rows before inserting the new
      // ones, so switching presets replaces rather than piles up. Manual
      // and connection-derived rows are untouched.
      await deps.presetSeeder.seed(agentId, preset, deps.ownerSub);
      // The `all` preset seeds host:* method:* path:* — a single row that
      // removes every egress restriction; flag it explicitly.
      securityLog("info", "egress_rule.preset", {
        category: "authz-list",
        actor: deps.ownerSub,
        actorKind: "user",
        agentId,
        detail: { preset, ...(preset === "all" ? { unrestricted: true } : {}) },
      });
    },
  };
}
