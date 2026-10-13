import type { SpendService } from "api-server-api";
import type { SpendLedger } from "../infrastructure/spend-ledger.js";

export function createSpendService(deps: {
  ledger: SpendLedger;
  ownerSub: string;
  agentBinding: readonly string[] | "*";
}): SpendService {
  return {
    async daily({ agentId, from, to }) {
      const agentIds = agentId
        ? [agentId]
        : deps.agentBinding === "*"
          ? null
          : deps.agentBinding;
      return deps.ledger.daily({ ownerSub: deps.ownerSub, agentIds, from, to });
    },
  };
}
