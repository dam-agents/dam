import type { SpendAmount, SpendBreakdown } from "api-server-api";

import { useNow } from "@/hooks/use-now";

import { useStore } from "../../../store.js";
import { SESSION_CATEGORY_LABELS } from "../../sessions/lib/session-category.js";
import { useSpendBreakdown } from "../../spend/api/queries.js";
import { amountsLabel } from "../../spend/lib/amounts-label.js";
import { NO_SESSION, SUB_AGENTS } from "../../spend/lib/copy.js";
import { rangeOf } from "../../spend/lib/spend-period.js";
import { utcDayOf } from "../../spend/lib/utc-day.js";
import { Card } from "./home-cards.js";

const REFRESH_MS = 60_000;

type SessionKind = SpendBreakdown["bySessionType"][number]["category"];

function kindLabel(kind: SessionKind): string {
  if (kind === "subagents") return SUB_AGENTS;
  if (kind === "none") return NO_SESSION;
  return SESSION_CATEGORY_LABELS[kind];
}

function useThisMonth() {
  const today = utcDayOf(useNow(REFRESH_MS));
  return useSpendBreakdown(rangeOf("this-month", today));
}

interface Group<K> {
  key: K;
  amounts: SpendAmount[];
  paidMicros: number;
  calls: number;
}

function groupBy<T extends SpendAmount & { calls?: number }, K extends string>(
  rows: readonly T[],
  keyOf: (row: T) => K,
): Group<K>[] {
  const groups = new Map<K, Group<K>>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key) ?? {
      key,
      amounts: [],
      paidMicros: 0,
      calls: 0,
    };
    groups.set(key, group);
    group.amounts.push({ unit: row.unit, costMicros: row.costMicros });
    if (row.unit === "usd") group.paidMicros += row.costMicros;
    group.calls += row.calls ?? 0;
  }
  return [...groups.values()];
}

export function SpendByKindCard() {
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const { data, isLoading } = useThisMonth();
  const rows = groupBy(data?.bySessionType ?? [], (row) => row.category)
    .map((group) => ({ ...group, label: amountsLabel(group.amounts) }))
    .filter((group) => group.label !== null)
    .sort((a, b) => b.paidMicros - a.paidMicros);
  const top = Math.max(0, ...rows.map((row) => row.paidMicros));
  return (
    <Card
      title="Spend by kind of session, this month"
      onOpen={() => navigateToSettings("usage", { period: "this-month" })}
    >
      <ul className="flex flex-col gap-2.5 text-sm">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-col gap-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {kindLabel(row.key)}
              </span>
              <span className="text-foreground tabular-nums">{row.label}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-accent/70"
                style={{ width: `${top ? (row.paidMicros * 100) / top : 0}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {isLoading ? "Loading…" : "No spend this month."}
        </p>
      )}
    </Card>
  );
}

export function ModelsCard() {
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const { data, isLoading } = useThisMonth();
  const models = groupBy(data?.byModel ?? [], (row) => row.model)
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 5);
  return (
    <Card
      title="Models, this month"
      onOpen={() => navigateToSettings("usage", { period: "this-month" })}
    >
      <ul className="flex flex-col gap-2 text-sm">
        {models.map((model) => (
          <li key={model.key} className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
              {model.key}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {model.calls} calls
            </span>
            <span className="text-right text-foreground tabular-nums">
              {amountsLabel(model.amounts) ?? "—"}
            </span>
          </li>
        ))}
      </ul>
      {models.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {isLoading ? "Loading…" : "No model calls this month."}
        </p>
      )}
    </Card>
  );
}
