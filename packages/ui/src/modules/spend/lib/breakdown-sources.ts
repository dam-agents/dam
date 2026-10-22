import {
  connectionLimitRule,
  providerTypeForTemplateId,
  type SpendAmount,
  type SpendBreakdown,
} from "api-server-api";

import { DELETED_AGENT_NAME, moreSubAgents } from "./copy.js";
import { amountsBy, unitTotals } from "./measured-spend.js";
import type { RowSource } from "./spend-rows.js";

interface Counted extends SpendAmount {
  calls: number;
}

function freeCallsBy<T extends Counted>(
  rows: readonly T[],
  keyOf: (row: T) => string,
): Map<string, number> {
  const calls = new Map<string, number>();
  for (const row of rows) {
    if (row.unit !== "free") continue;
    calls.set(keyOf(row), (calls.get(keyOf(row)) ?? 0) + row.calls);
  }
  return calls;
}

function sourcesBy<T extends Counted>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  describe: (key: string) => {
    label: string;
    hint?: string;
    notPriced: boolean;
  },
): RowSource[] {
  const freeCalls = freeCallsBy(rows, keyOf);
  return [...amountsBy(rows, keyOf)].map(([key, amounts]) => ({
    key,
    amounts,
    freeCalls: freeCalls.get(key) ?? 0,
    ...describe(key),
  }));
}

type AgentRow = SpendBreakdown["byAgent"][number] & {
  agentTask?: string | null;
};

export const MORE_SUB_AGENTS_KEY = "more-sub-agents";

export function agentNameOf(
  rows: readonly AgentRow[],
): (agentId: string) => string | null {
  const names = new Map(rows.map((row) => [row.agentId, row.agentName]));
  return (agentId) => names.get(agentId) ?? null;
}

export function agentLabel(agentName: string | null): string {
  return agentName ?? DELETED_AGENT_NAME;
}

export function agentSources(
  rows: readonly AgentRow[],
  labelOf: (agentId: string, agentName: string | null) => string = (
    _agentId,
    agentName,
  ) => agentLabel(agentName),
): RowSource[] {
  const nameOf = agentNameOf(rows);
  const taskOf = new Map(rows.map((row) => [row.agentId, row.agentTask]));
  return sourcesBy(
    rows,
    (row) => row.agentId,
    (agentId) => {
      const task = taskOf.get(agentId);
      return {
        label: labelOf(agentId, nameOf(agentId)),
        ...(task && { hint: task }),
        notPriced: false,
      };
    },
  );
}

export function moreSubAgentsSource(
  other: SpendBreakdown["otherSubAgents"],
): RowSource {
  return {
    key: MORE_SUB_AGENTS_KEY,
    label: moreSubAgents(other.count),
    amounts: unitTotals(other.amounts),
    freeCalls: other.amounts
      .filter((amount) => amount.unit === "free")
      .reduce((sum, amount) => sum + amount.calls, 0),
    notPriced: false,
  };
}

export function inServerOrder<T extends { key: string }>(
  rows: readonly T[],
  agentIds: readonly string[],
): T[] {
  const rank = new Map(agentIds.map((agentId, index) => [agentId, index]));
  const rankOf = (key: string) => rank.get(key) ?? Number.MAX_SAFE_INTEGER;
  return [...rows].sort((a, b) => rankOf(a.key) - rankOf(b.key));
}

export function sessionTypeSources(
  bySessionType: SpendBreakdown["bySessionType"],
  describe: (category: SessionType) => { label: string; help?: string },
): RowSource[] {
  return [...amountsBy(bySessionType, (row) => row.category)].map(
    ([category, amounts]) => ({
      key: category,
      amounts,
      freeCalls: 0,
      notPriced: false,
      ...describe(category),
    }),
  );
}

export type SessionType = SpendBreakdown["bySessionType"][number]["category"];

export function modelSources(byModel: SpendBreakdown["byModel"]): RowSource[] {
  return sourcesBy(
    byModel,
    (row) => row.model,
    (model) => ({ label: model, notPriced: false }),
  );
}

function isUnpriced(templateId: string): boolean {
  const rule = connectionLimitRule(templateId);
  return !rule.limitable && rule.reason !== "free";
}

function isNotMetered(templateId: string): boolean {
  const rule = connectionLimitRule(templateId);
  return !rule.limitable && rule.reason === "not_metered";
}

export interface ProviderConnection {
  id: string;
  name: string;
  templateId: string;
}

export function connectionSources(
  byConnection: SpendBreakdown["byConnection"],
  connections: readonly ProviderConnection[],
): RowSource[] {
  const rowOf = new Map(byConnection.map((row) => [row.connectionId, row]));
  const measured = sourcesBy(
    byConnection,
    (row) => row.connectionId,
    (connectionId) => {
      const row = rowOf.get(connectionId);
      return {
        label: row?.connectionName ?? connectionId,
        notPriced: row ? isUnpriced(row.providerTemplate) : false,
      };
    },
  );
  const unmetered = connections
    .filter(
      (connection) =>
        !rowOf.has(connection.id) &&
        providerTypeForTemplateId(connection.templateId) !== null &&
        isNotMetered(connection.templateId),
    )
    .map((connection) => ({
      key: connection.id,
      label: connection.name,
      amounts: { usd: 0, usd_list: 0, bobcoin: 0, free: 0 },
      freeCalls: 0,
      notPriced: true,
    }));
  return [...measured, ...unmetered];
}
