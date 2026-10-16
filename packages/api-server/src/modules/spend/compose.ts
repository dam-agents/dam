import type { Db } from "db";
import type { Redis } from "ioredis";
import type { Subscription } from "rxjs";
import type { SpendService } from "api-server-api";
import { getLogger } from "../../core/logger.js";
import type { PriceBook } from "./domain/prices.js";
import { loadAnthropicPriceTable } from "./infrastructure/anthropic-price-table.js";
import { createRedisCallStates } from "./infrastructure/call-states.js";
import { createRedisDayCounters } from "./infrastructure/day-counters.js";
import {
  operatorPrices,
  type OperatorPriceInput,
} from "./infrastructure/operator-prices.js";
import { createSpendLedger } from "./infrastructure/spend-ledger.js";
import { createSpendLimits } from "./infrastructure/spend-limits.js";
import {
  createUserSpendCeilings,
  type CustomObjectReader,
} from "./infrastructure/user-spend-ceilings.js";
import {
  startExtendOnContinueSaga,
  type SpendQuestions,
} from "./sagas/extend-on-continue.js";
import {
  createDayTotals,
  createSpendCheck,
  type GrantedConnections,
  type SpendCheck,
} from "./services/spend-check.js";
import {
  createSpendIngest,
  type AgentOwners,
  type SessionOwnership,
  type SpendIngest,
} from "./services/spend-ingest.js";
import {
  createSpendService,
  type AgentPayers,
  type ConnectionNames,
  type OwnedAgentAges,
  type SessionCategories,
  type SpawnedSubAgents,
  type SpendQuestionCloser,
} from "./services/spend-service.js";

const CALL_ROWS_RETENTION_DAYS = 30;

function composePriceBook(
  priceOverrides: readonly OperatorPriceInput[],
): PriceBook {
  return {
    operatorPrices: operatorPrices(priceOverrides),
    anthropicTable: loadAnthropicPriceTable(),
  };
}

export interface SpendSystem {
  ingest: SpendIngest;
  check: SpendCheck;
  extendSaga: Subscription;
  callRowsRetentionTick(): Promise<void>;
  forOwner(deps: {
    ownerSub: string;
    agentBinding: readonly string[] | "*";
    isAgentOwnedBy(agentId: string, ownerSub: string): Promise<boolean>;
  }): SpendService;
}

export function composeSpendSystem(deps: {
  db: Db;
  redis: Redis;
  priceOverrides: readonly OperatorPriceInput[];
  owners: AgentOwners;
  payers: AgentPayers;
  questions: SpendQuestions & SpendQuestionCloser;
  connections: GrantedConnections;
  k8s: CustomObjectReader;
  defaultCeilingMicros: number | null;
  brandName: string;
  connectionNames: ConnectionNames;
  ownedAgents: OwnedAgentAges;
  sessions: SessionOwnership & SessionCategories;
  subAgents: SpawnedSubAgents;
  telemetryStoreOn: boolean;
}): SpendSystem {
  const ledger = createSpendLedger(deps.db);
  const counters = createRedisDayCounters(deps.redis);
  const limits = createSpendLimits(deps.db);
  const ceilings = createUserSpendCeilings({
    k8s: deps.k8s,
    defaultMicros: deps.defaultCeilingMicros,
  });
  const totals = createDayTotals({ counters, ledger });
  let startedAt: Promise<Date> | null = null;
  const meteringStart = () =>
    (startedAt ??= ledger.meteringStart().catch((error: unknown) => {
      startedAt = null;
      throw error;
    }));
  const ingest = createSpendIngest({
    priceBook: composePriceBook(deps.priceOverrides),
    calls: createRedisCallStates(deps.redis),
    ledger,
    counters,
    owners: deps.owners,
    sessions: deps.sessions,
  });
  return {
    ingest,
    async callRowsRetentionTick() {
      const deleted = await ledger.deleteCallsBefore(
        new Date(Date.now() - CALL_ROWS_RETENTION_DAYS * 86_400_000),
      );
      if (deleted > 0)
        getLogger().info(
          { deleted, days: CALL_ROWS_RETENTION_DAYS },
          "spend.call_rows_deleted",
        );
    },
    check: createSpendCheck({
      limits,
      ceilings,
      totals,
      ledger,
      ingest,
      owners: deps.owners,
      sessions: deps.sessions,
      connections: deps.connections,
      brandName: deps.brandName,
    }),
    extendSaga: startExtendOnContinueSaga({
      questions: deps.questions,
      limits,
    }),
    forOwner: (owner) =>
      createSpendService({
        ledger,
        limits,
        ceilings,
        totals,
        connections: deps.connections,
        questions: deps.questions,
        payers: deps.payers,
        sessions: deps.sessions,
        subAgents: deps.subAgents,
        meteringStart,
        connectionNames: () => deps.connectionNames.namesOf(owner.ownerSub),
        ownedAgentCreatedBefore: (at) =>
          deps.ownedAgents.anyCreatedBefore(owner.ownerSub, at),
        telemetryStoreOn: deps.telemetryStoreOn,
        ...owner,
      }),
  };
}

export function createSpendLimitsCleanupHook(
  db: Db,
): (agentId: string) => Promise<void> {
  const limits = createSpendLimits(db);
  return (agentId) => limits.deleteForAgent(agentId);
}

export function listSpendLimitAgentIds(db: Db): Promise<string[]> {
  return createSpendLimits(db).listAgentIds();
}
