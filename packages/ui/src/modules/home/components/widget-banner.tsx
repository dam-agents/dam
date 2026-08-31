import { useMemo, useState } from "react";

import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { AgentView, Schedule } from "../../../types.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { useBudgetReserved } from "../../budgets/api/queries.js";
import { formatCores, formatGi } from "../../budgets/lib/format.js";
import { useSpendBreakdown } from "../../metrics/api/queries.js";
import { totalCostUsd } from "../../metrics/lib/totals.js";
import { useToggleSchedule } from "../../schedules/api/mutations.js";
import { useOwnerSchedules } from "../../schedules/api/queries.js";
import { ScheduleFormModal } from "../../schedules/forms/schedule-form-modal.js";
import { useScheduleEditGuard } from "../../schedules/hooks/use-schedule-edit-guard.js";
import { scheduleCadenceText } from "../../schedules/lib/schedule-format.js";
import {
  type ComputeCell,
  type ComputeCellState,
  computeView,
} from "../lib/compute-cells.js";
import {
  SPEND_PERIODS,
  type SpendPeriod,
  spendRange,
} from "../lib/spend-period.js";

const BYTES_PER_MI = 1024 ** 2;
const TOP_SPENDERS = 3;
const TOP_SCHEDULES = 5;
const ROUNDS_TO_A_VISIBLE_CENT_USD = 0.005;

const STATE_LABEL: Record<Exclude<ComputeCellState, "available">, string> = {
  running: "Working",
  awake: "Awake",
};

const STATE_DOT: Record<Exclude<ComputeCellState, "available">, string> = {
  running: "bg-success",
  awake: "bg-accent",
};

interface Props {
  runningAgents: readonly AgentView[];
  workingAgentIds: ReadonlySet<string>;
}

function cellTitle(cell: ComputeCell): string {
  if (cell.state === "available") return "Available";
  return `${cell.agentName} — ${formatCores(cell.cpuMilli)} CPU · ${formatGi(cell.memoryMi * BYTES_PER_MI)} Gi`;
}

function ComputeBanner({ runningAgents, workingAgentIds }: Props) {
  const { data } = useBudgetReserved();

  if (!data) {
    return (
      <div className="flex flex-col rounded-2xl border border-border bg-card p-5">
        <p className="text-sm text-muted-foreground">Compute</p>
        <p className="text-lg font-bold text-foreground">—</p>
      </div>
    );
  }

  const view = computeView(
    runningAgents,
    workingAgentIds,
    data.cpu.ceilingMilli,
  );

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-5">
      <p className="mb-1 text-sm text-muted-foreground">Compute allocated</p>
      <p className="mb-1 text-xl font-bold tracking-tight text-foreground tabular-nums">
        {formatCores(view.usedMilli)}/{formatCores(view.ceilingMilli)}
      </p>
      <p className="mb-3 text-sm text-muted-foreground">CPU</p>

      <div
        className="mb-3 flex gap-0.5 [&>span]:flex-1"
        role="group"
        aria-label="Allocated CPU"
      >
        {view.cells.map((cell, index) => (
          <Tooltip key={index} content={cellTitle(cell)} side="bottom">
            <span
              aria-label={cellTitle(cell)}
              className={cn(
                "h-3 w-full",
                index === 0 && "rounded-l-full",
                index === view.cells.length - 1 && "rounded-r-full",
                cell.state === "running" && "bg-success",
                cell.state === "awake" && "bg-accent",
                cell.state === "available" &&
                  "border border-muted-foreground/25 bg-background",
              )}
            />
          </Tooltip>
        ))}
      </div>

      <div className="space-y-1.5">
        {view.groups.map((group) => (
          <div
            key={group.state}
            className="flex items-center justify-between text-sm text-muted-foreground"
          >
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-block size-2.5 shrink-0 rounded-full",
                  STATE_DOT[group.state],
                )}
              />
              {STATE_LABEL[group.state]}
            </span>
            <span className="tabular-nums">
              {group.agents} · {formatCores(group.cpuMilli)} CPU ·{" "}
              {formatGi(group.memoryMi * BYTES_PER_MI)} Gi
            </span>
          </div>
        ))}
        {view.groups.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No agents holding compute.
          </p>
        )}
      </div>
    </div>
  );
}

function SpendBanner() {
  const [period, setPeriod] = useState<SpendPeriod>("1m");
  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );
  const { from, to } = useMemo(() => spendRange(period, new Date()), [period]);
  const { data, isUnavailable, isPending } = useSpendBreakdown(
    from,
    to,
    timeZone,
  );

  if (isUnavailable) return null;

  if (isPending) {
    return (
      <div className="flex flex-col rounded-2xl border border-border bg-card p-5">
        <p className="text-sm text-muted-foreground">Spend</p>
        <p className="text-lg font-bold text-foreground">—</p>
      </div>
    );
  }

  const total = data ? totalCostUsd(data.byModel) : 0;
  const spenders = (data?.byAgent ?? [])
    .filter((row) => row.costUsd >= ROUNDS_TO_A_VISIBLE_CENT_USD)
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, TOP_SPENDERS);
  const top = spenders[0]?.costUsd ?? 0;

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-5">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Spend</p>
        <div className="flex shrink-0 gap-0.5 rounded-md border border-border/50 bg-muted/40 p-0.5">
          {SPEND_PERIODS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setPeriod(option)}
              aria-pressed={option === period}
              className={cn(
                "rounded-md px-1.5 py-0.5 text-sm transition-colors",
                option === period
                  ? "bg-card font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-3 text-xl font-bold tracking-tight text-foreground tabular-nums">
        ${total.toFixed(2)}
      </p>

      {spenders.length > 0 ? (
        <div className="space-y-2.5">
          {spenders.map((spender) => (
            <div key={spender.agentId}>
              <div className="mb-1 flex items-center justify-between">
                <span className="truncate text-sm text-muted-foreground">
                  {spender.agentName}
                </span>
                <span className="ml-2 shrink-0 text-sm text-muted-foreground tabular-nums">
                  ${spender.costUsd.toFixed(2)}
                </span>
              </div>
              <div
                className="h-2.5 rounded-full bg-accent"
                style={{
                  width: top > 0 ? `${(spender.costUsd / top) * 100}%` : "0%",
                }}
              />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No spend in this period.
        </p>
      )}
    </div>
  );
}

function SchedulesBanner() {
  const { data, isPending } = useOwnerSchedules();
  const agents = useAgentsList();
  const toggle = useToggleSchedule();
  const guardEdit = useScheduleEditGuard();
  const [editing, setEditing] = useState<Schedule | null>(null);

  if (isPending) {
    return (
      <div className="flex flex-col rounded-2xl border border-border bg-card p-5">
        <p className="text-sm text-muted-foreground">Schedules</p>
        <p className="text-lg font-bold text-foreground">—</p>
      </div>
    );
  }

  const live = new Set(agents.map((a) => a.id));
  const schedules = (data ?? []).filter((s) => live.has(s.agentId));
  const nameOf = (agentId: string) =>
    agents.find((a) => a.id === agentId)?.name ?? agentId;

  return (
    <>
      <div className="flex flex-col rounded-2xl border border-border bg-card p-5">
        <p className="mb-3 text-sm text-muted-foreground">
          Schedules
          {schedules.length > 0 && (
            <span className="ml-1">({schedules.length})</span>
          )}
        </p>

        {schedules.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
        ) : (
          <div className="space-y-0.5">
            {schedules.slice(0, TOP_SCHEDULES).map((schedule) => (
              <div
                key={schedule.id}
                className={cn(
                  "group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/50",
                  !schedule.enabled && "opacity-50",
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    void guardEdit(schedule, nameOf(schedule.agentId), () => {
                      setEditing(schedule);
                    });
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm text-foreground">
                    {schedule.name}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {nameOf(schedule.agentId)} · {scheduleCadenceText(schedule)}
                  </p>
                </button>
                <Switch
                  checked={schedule.enabled}
                  disabled={toggle.isPending}
                  onCheckedChange={() => toggle.mutate({ id: schedule.id })}
                  className="shrink-0"
                  aria-label={`${schedule.enabled ? "Disable" : "Enable"} ${schedule.name}`}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <ScheduleFormModal
          agentId={editing.agentId}
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
    </>
  );
}

export function WidgetBanner({ runningAgents, workingAgentIds }: Props) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <ComputeBanner
        runningAgents={runningAgents}
        workingAgentIds={workingAgentIds}
      />
      <SpendBanner />
      <SchedulesBanner />
    </div>
  );
}
