import { promotedHosts, type EgressRuleSource } from "api-server-api";
import type {
  EgressRulesRepository,
  NewEgressRule,
} from "../infrastructure/egress-rules-repository.js";
import type { EgressRuleRow } from "../domain/types.js";
import type { AgentL7HostsPort } from "../infrastructure/k8s-agent-l7-hosts-port.js";

export interface CreateEgressRuleWriterDeps {
  repo: EgressRulesRepository;
  l7Hosts?: AgentL7HostsPort;
}

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
      if (row.verdict !== input.verdict) {
        return { kind: "verdict-clash", existing: row };
      }
      let outcome: EgressRuleWriteOutcome;
      if (row.id === input.id) {
        outcome = { kind: "inserted", row };
      } else if (
        row.source !== "manual" &&
        row.source !== "inbox" &&
        (input.source === "manual" || input.source === "inbox")
      ) {
        const promoted = await deps.repo.updateTakeOwnership({
          id: row.id,
          method: row.method,
          pathPattern: row.pathPattern,
          verdict: row.verdict,
          decidedBy: input.decidedBy,
          source: input.source,
        });
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
