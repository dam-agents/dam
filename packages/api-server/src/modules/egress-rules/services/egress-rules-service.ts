import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  promotedHosts,
  type EgressPreset,
  type EgressRuleCreateInput,
  type EgressRuleUpdateInput,
  type EgressRuleView,
  type EgressRulesService,
} from "api-server-api";
import type { EgressRulesRepository } from "../infrastructure/egress-rules-repository.js";
import type { EgressRuleRow } from "../domain/types.js";
import type { AgentL7HostsPort } from "../infrastructure/k8s-agent-l7-hosts-port.js";
import type { PresetSeeder } from "./preset-seeder.js";
import { securityLog } from "../../../core/security-log.js";

export interface CreateEgressRulesServiceDeps {
  repo: EgressRulesRepository;
  l7Hosts?: AgentL7HostsPort;
  presetSeeder?: PresetSeeder;
  trustedHosts: readonly string[];
  isAgentOwnedBy(agentId: string, ownerSub: string): Promise<boolean>;
  ownerSub: string;
}

function toView(row: EgressRuleRow): EgressRuleView {
  return {
    id: row.id,
    agentId: row.agentId,
    host: row.host,
    ...(row.port ? { port: row.port } : {}),
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
  async function reconvergePromotions(agentId: string): Promise<void> {
    if (!deps.l7Hosts) return;
    const rows = await deps.repo.listForAgent(agentId);
    await deps.l7Hosts.set(agentId, promotedHosts(rows));
  }

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
      let row = await deps.repo.insert({
        id: randomUUID(),
        agentId: input.agentId,
        host: input.host,
        ...(input.port ? { port: input.port } : {}),
        method: input.method,
        pathPattern: input.pathPattern,
        verdict: input.verdict,
        decidedBy: deps.ownerSub,
        source: "manual",
      });
      if (row.verdict !== input.verdict) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `an equivalent rule already exists with verdict '${row.verdict}' — edit the existing rule instead`,
        });
      }
      if ((row.port ?? null) !== (input.port ?? null)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `an equivalent rule already exists ${row.port ? `for port ${row.port}` : "without a port"} — revoke it and create the rule again`,
        });
      }
      if (row.source !== "manual" && row.source !== "inbox") {
        row =
          (await deps.repo.updateTakeOwnership({
            id: row.id,
            method: row.method,
            pathPattern: row.pathPattern,
            verdict: row.verdict,
            decidedBy: deps.ownerSub,
            source: "manual",
          })) ?? row;
      }
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
      await reconvergePromotions(input.agentId);
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
      const updated = await deps.repo.updateTakeOwnership({
        id: input.id,
        method,
        pathPattern,
        verdict,
        decidedBy: deps.ownerSub,
        source: "manual",
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
      await reconvergePromotions(updated.agentId);
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
      await reconvergePromotions(rule.agentId);
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
      await deps.presetSeeder.seed(agentId, preset, deps.ownerSub);
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
