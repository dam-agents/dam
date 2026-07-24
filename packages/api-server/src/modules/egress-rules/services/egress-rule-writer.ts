import type { EgressRuleSource } from "api-server-api";
import type {
  EgressRulesRepository,
  NewEgressRule,
} from "../infrastructure/egress-rules-repository.js";
import type { EgressRuleRow } from "../domain/types.js";
import { promotedHosts } from "../domain/l7-promotion.js";
import type { AgentL7HostsPort } from "../infrastructure/k8s-agent-l7-hosts-port.js";

/**
 * Insert path for rules born from inbox verdicts (approve-permanent /
 * deny-forever).
 *
 * Mirrors the manual-create path's L7 promotion: a narrow rule written from
 * an inbox verdict (possible when the held request was plain HTTP, where
 * method/path are visible without MITM) must promote its host onto the
 * agent's L7 chain, or the rule's HTTPS half is silently unenforced (#2322).
 * Promotion is per-agent — `spec.l7Hosts` on the Agent CR (#2865) — and
 * reconverged from the agent's full active rule set so the write is a pure
 * projection of the rules table.
 */
export interface CreateEgressRuleWriterDeps {
  repo: EgressRulesRepository;
  /** Optional so non-cluster contexts (tests) can skip the side effect. */
  l7Hosts?: AgentL7HostsPort;
}

/** What the insert actually did, so the caller can refuse to report a
 *  verdict as applied when the rules table is unchanged (#2766). Mirrors
 *  the manual-create semantics from #2765: opposite-verdict clash is
 *  surfaced, same-verdict duplicate is idempotent, and an explicit user
 *  decision takes ownership of an equivalent implicit rule. */
export type EgressRuleWriteOutcome =
  | { kind: "inserted"; row: EgressRuleRow }
  | {
      kind: "duplicate";
      row: EgressRuleRow;
      tookOwnershipFrom?: EgressRuleSource;
    }
  | { kind: "verdict-clash"; existing: EgressRuleRow };

export function createEgressRuleWriter(deps: CreateEgressRuleWriterDeps): {
  insert(input: NewEgressRule): Promise<EgressRuleWriteOutcome>;
} {
  return {
    async insert(input) {
      const row = await deps.repo.insert(input);
      // The rules table is unchanged on a clash — skip the reconverge and
      // let the caller surface the conflict.
      if (row.verdict !== input.verdict) {
        return { kind: "verdict-clash", existing: row };
      }
      let outcome: EgressRuleWriteOutcome;
      // The caller mints the id, so id equality discriminates a fresh
      // insert from the pre-existing row the repo returns on tuple conflict.
      if (row.id === input.id) {
        outcome = { kind: "inserted", row };
      } else if (
        row.source !== "manual" &&
        row.source !== "inbox" &&
        (input.source === "manual" || input.source === "inbox")
      ) {
        // Same-verdict duplicate of a preset/connection row: the explicit
        // decision takes ownership so a later preset switch or connection
        // revoke can't silently undo it (mirrors manual create, #2765).
        const promoted = await deps.repo.updateTakeOwnership({
          id: row.id,
          method: row.method,
          pathPattern: row.pathPattern,
          verdict: row.verdict,
          decidedBy: input.decidedBy,
          source: input.source,
        });
        // `promoted` is null when the row was revoked in the window since
        // the conflict read — don't audit a takeover that never happened.
        outcome = promoted
          ? { kind: "duplicate", row: promoted, tookOwnershipFrom: row.source }
          : { kind: "duplicate", row };
      } else {
        outcome = { kind: "duplicate", row };
      }
      if (deps.l7Hosts) {
        const rows = await deps.repo.listForAgent(input.agentId);
        await deps.l7Hosts.set(input.agentId, promotedHosts(rows));
      }
      return outcome;
    },
  };
}
