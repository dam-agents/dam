import {
  connectionLimitRule,
  providerTypeForTemplateId,
  type SpendAmount,
  type SpendBreakdown,
} from "api-server-api";

import { amountsBy } from "./measured-spend.js";
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
  describe: (key: string) => { label: string; notPriced: boolean },
): RowSource[] {
  const freeCalls = freeCallsBy(rows, keyOf);
  return [...amountsBy(rows, keyOf)].map(([key, amounts]) => ({
    key,
    amounts,
    freeCalls: freeCalls.get(key) ?? 0,
    ...describe(key),
  }));
}

export function agentSources(
  byAgent: SpendBreakdown["byAgent"],
  nameOf: (agentId: string) => string | undefined,
): RowSource[] {
  return sourcesBy(
    byAgent,
    (row) => row.agentId,
    (agentId) => ({ label: nameOf(agentId) ?? agentId, notPriced: false }),
  );
}

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
