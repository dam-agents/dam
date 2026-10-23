import type { Db } from "db";
import type { Redis } from "ioredis";
import type { Subscription } from "rxjs";
import { CALL_ROWS_RETENTION_DAYS, type SpendService } from "api-server-api";
import { getLogger } from "../../core/logger.js";
import type { PriceBook } from "./domain/prices.js";
import { loadAnthropicPriceTable } from "./infrastructure/anthropic-price-table.js";
import { createRedisCallStates } from "./infrastructure/call-states.js";
import { createRedisDayCounters } from "./infrastructure/day-counters.js";
import {
  operatorPrices,
  type OperatorPriceInput,
} from "./infrastructure/operator-prices.js";
import { createLastKnownNames } from "./infrastructure/last-known-names.js";
import { createSpendLedger } from "./infrastructure/spend-ledger.js";
import { createSpendLimits } from "./infrastructure/spend-limits.js";
import { createSpendCeilingStore } from "./infrastructure/spend-ceilings.js";
import {
  startExtendOnContinueSaga,
  type SpendQuestions,
} from "./sagas/extend-on-continue.js";
import { startDropConnectionLimitsSaga } from "./sagas/drop-connection-limits.js";
import { startKeepLastKnownNameSaga } from "./sagas/keep-last-known-name.js";
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
  type AgentNames,
  type AgentPayers,
  type ConnectionNames,
  type InvocationTasks,
  type OwnedAgentAges,
  type SessionCategories,
  type SpendQuestionCloser,
} from "./services/spend-service.js";
import type { SpawnedSubAgents } from "./services/session-spend.js";
import {
  createAgentSpend,
  type AgentSpendReader,
} from "./services/agent-spend.js";
import {
  createSpendCeilingsAdmin,
  type CeilingUsers,
  type SpendCeilingsForOperator,
} from "./services/spend-ceilings-admin.js";

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
  lastKnownNameSaga: Subscription;
  connectionLimitsSaga: Subscription;
  agentSpend: AgentSpendReader;
  callRowsRetentionTick(): Promise<void>;
  forOwner(deps: {
    ownerSub: string;
    agentBinding: readonly string[] | "*";
    isAgentOwnedBy(agentId: string, ownerSub: string): Promise<boolean>;
  }): SpendService;
  ceilingsForOperator: SpendCeilingsForOperator;
}

export function composeSpendSystem(deps: {
  db: Db;
  redis: Redis;
  priceOverrides: readonly OperatorPriceInput[];
  owners: AgentOwners;
  payers: AgentPayers;
  questions: SpendQuestions & SpendQuestionCloser;
  connections: GrantedConnections;
  users: CeilingUsers;
  defaultCeilingMicros: number | null;
  brandName: string;
  connectionNames: ConnectionNames;
  agentNames: AgentNames;
  invocationTasks: InvocationTasks;
  ownedAgents: OwnedAgentAges;
  sessions: SessionOwnership & SessionCategories;
  subAgents: SpawnedSubAgents;
  telemetryStoreOn: boolean;
}): SpendSystem {
  const ledger = createSpendLedger(deps.db);
  const counters = createRedisDayCounters(deps.redis);
  const limits = createSpendLimits(deps.db);
  const lastKnownNames = createLastKnownNames(deps.db);
  const ceilings = createSpendCeilingStore({
    db: deps.db,
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
    agentSpend: createAgentSpend({
      ledger,
      payers: deps.payers,
      owners: deps.owners,
      subAgents: deps.subAgents,
      meteringStart,
    }),
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
    lastKnownNameSaga: startKeepLastKnownNameSaga({ names: lastKnownNames }),
    connectionLimitsSaga: startDropConnectionLimitsSaga({
      limits,
      questions: deps.questions,
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
        liveAgentNames: () => deps.agentNames.namesOf(owner.ownerSub),
        lastKnownNames: (agentIds) =>
          lastKnownNames.namesOf(owner.ownerSub, agentIds),
        invocationTasks: (agentIds) =>
          deps.invocationTasks.tasksOf(owner.ownerSub, agentIds),
        ownedAgentCreatedBefore: (at) =>
          deps.ownedAgents.anyCreatedBefore(owner.ownerSub, at),
        telemetryStoreOn: deps.telemetryStoreOn,
        ...owner,
      }),
    ceilingsForOperator: createSpendCeilingsAdmin({
      store: ceilings,
      users: deps.users,
      defaultMicros: deps.defaultCeilingMicros,
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
