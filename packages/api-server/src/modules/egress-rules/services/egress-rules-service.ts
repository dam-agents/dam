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
import { promotedHosts } from "../domain/l7-promotion.js";
import type { AgentL7HostsPort } from "../infrastructure/k8s-agent-l7-hosts-port.js";
import type { PresetSeeder } from "./preset-seeder.js";
import { securityLog } from "../../../core/security-log.js";

export interface CreateEgressRulesServiceDeps {
  repo: EgressRulesRepository;
  /** Port that promotes a host onto the agent's L7 chain via the Agent
   *  CR's spec.l7Hosts (#2865). Optional so non-cluster contexts (tests)
   *  can skip the side effect. */
  l7Hosts?: AgentL7HostsPort;
  /** Bulk-seeder used by `applyPreset`. Optional so non-cluster contexts
   *  (tests) can skip preset operations. */
  presetSeeder?: PresetSeeder;
  /** Same list the seeder uses; surfaced so the UI can preview trusted
   *  rules without committing to a preset switch. */
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
  // Recompute the agent's promoted-host set from its active rules and write
  // it wholesale, so spec.l7Hosts stays a pure projection of the rules
  // table (#2865). Run after every mutation — create/update *and* revoke —
  // so a narrowing that no longer exists drops its host instead of
  // ratcheting forever. Idempotent: the port skips the patch (and the
  // gateway roll) when the set is unchanged.
  //
  // Deliberately NOT transactional with the rule write: if the CR patch
  // throws (conflict retries exhausted, pruned write), the rule row stays
  // committed and the caller sees the error — fail-loud, never
  // silently-unpromoted (#2322). The gap self-heals: the projection is
  // recomputed from the table on the agent's next rule mutation, and the
  // periodic l7-promotion-reconcile re-projects every agent with active
  // narrow rules — covering the case where the process died between the
  // rule commit and the patch, which no in-request retry can.
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
      // Insert conflicted with an existing rule carrying a different verdict.
      // Nothing changed, so bail before the create audit log and L7 side
      // effect — changing a verdict is the update/edit path's job.
      if (row.verdict !== input.verdict) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `an equivalent rule already exists with verdict '${row.verdict}' — edit the existing rule instead`,
        });
      }
      // Port is outside the rule's unique key and not editable, so a
      // port-differing duplicate can't be stored or fixed by edit — reject
      // rather than return a rule that misrepresents the requested port.
      if ((row.port ?? null) !== (input.port ?? null)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `an equivalent rule already exists ${row.port ? `for port ${row.port}` : "without a port"} — revoke it and create the rule again`,
        });
      }
      // Same-verdict duplicate of a preset/connection row: the manual create
      // takes ownership (same intent as edit-promotes-to-manual), so a later
      // preset sweep or connection revoke won't silently drop a rule the
      // user explicitly asked for.
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
      // Path-specific rules need the host on the L7 chain so the ext_authz
      // handler can see method/path. spec.l7Hosts on the Agent CR is the
      // controller's per-agent signal to extend the cert SAN list and
      // render the chain (#2865); reconverge recomputes it from the agent's
      // full active rule set.
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
      // The user may have just narrowed `(host, *, *)` to `(host, GET, /v1/x)`
      // (promotes the host) or widened it back (demotes, if it was the last
      // narrowing on that host). Reconverge covers both directions.
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
      // Revoking the last narrowing on a host demotes it — reconverge drops
      // it from spec.l7Hosts so the gateway stops MITM-terminating a host
      // no rule needs anymore (#2865).
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
