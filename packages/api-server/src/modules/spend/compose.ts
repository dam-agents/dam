import type { Db } from "db";
import type { Redis } from "ioredis";
import type { SpendService } from "api-server-api";
import type { PriceBook } from "./domain/prices.js";
import { loadAnthropicPriceTable } from "./infrastructure/anthropic-price-table.js";
import { createRedisCallStates } from "./infrastructure/call-states.js";
import { createRedisDayCounters } from "./infrastructure/day-counters.js";
import {
  operatorPrices,
  type OperatorPriceInput,
} from "./infrastructure/operator-prices.js";
import { createSpendLedger } from "./infrastructure/spend-ledger.js";
import {
  createSpendIngest,
  type AgentOwners,
  type SpendIngest,
} from "./services/spend-ingest.js";
import { createSpendService } from "./services/spend-service.js";

function composePriceBook(
  priceOverrides: readonly OperatorPriceInput[],
): PriceBook {
  return {
    operatorPrices: operatorPrices(priceOverrides),
    anthropicTable: loadAnthropicPriceTable(),
  };
}

export function composeSpendSystem(deps: {
  db: Db;
  redis: Redis;
  priceOverrides: readonly OperatorPriceInput[];
  owners: AgentOwners;
}): { ingest: SpendIngest } {
  return {
    ingest: createSpendIngest({
      priceBook: composePriceBook(deps.priceOverrides),
      calls: createRedisCallStates(deps.redis),
      ledger: createSpendLedger(deps.db),
      counters: createRedisDayCounters(deps.redis),
      owners: deps.owners,
    }),
  };
}

export function composeSpendForOwner(deps: {
  db: Db;
  ownerSub: string;
  agentBinding: readonly string[] | "*";
}): SpendService {
  return createSpendService({
    ledger: createSpendLedger(deps.db),
    ownerSub: deps.ownerSub,
    agentBinding: deps.agentBinding,
  });
}
