import { Help } from "@carbon/icons-react";

import { Tooltip } from "@/components/ui/tooltip";
import { externalLinkProps } from "@/lib/external-link";
import { cn } from "@/lib/utils";

import { COMPUTE_REQUEST_URL } from "../../../constants.js";
import type { AgentView } from "../../../types.js";
import { useBudgetReserved } from "../../budgets/api/queries.js";
import { formatCores, formatGi } from "../../budgets/lib/format.js";
import {
  type ComputeCell,
  type ComputeCellState,
  computeView,
} from "../lib/compute-cells.js";

const BYTES_PER_MI = 1024 ** 2;

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
  return `${cell.agentName} — ${formatCores(cell.cpuMilli)} CPU · ${formatGi(
    cell.memoryMi * BYTES_PER_MI,
  )} Gi allocated`;
}

export function ComputeWidget({ runningAgents, workingAgentIds }: Props) {
  const { data } = useBudgetReserved();
  if (!data) return null;

  const view = computeView(
    runningAgents,
    workingAgentIds,
    data.cpu.ceilingMilli,
  );

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-6">
      <div className="mb-1 flex min-h-[32px] items-center justify-between">
        <span className="flex items-center gap-1.5">
          <p className="text-sm text-muted-foreground">Compute allocated</p>
          <Tooltip
            content="What your running sandboxes reserve, not what they are using. Stop or pause a sandbox to free it."
            side="bottom"
          >
            <Help size={16} className="cursor-help text-muted-foreground/50" />
          </Tooltip>
        </span>
        <a
          href={COMPUTE_REQUEST_URL}
          {...externalLinkProps}
          className="text-sm text-muted-foreground/60 transition-colors hover:text-muted-foreground"
        >
          Need more?
        </a>
      </div>

      <p className="mb-1 text-[28px] leading-none font-bold tracking-tight text-foreground tabular-nums">
        {formatCores(view.usedMilli)}/{formatCores(view.ceilingMilli)}
      </p>
      <p className="mb-5 text-sm text-muted-foreground">CPU</p>

      <div
        className="mb-5 flex gap-0.5 [&>span]:flex-1"
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

      <div className="space-y-2">
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
              {group.agents} {group.agents === 1 ? "sandbox" : "sandboxes"} ·{" "}
              {formatCores(group.cpuMilli)} CPU ·{" "}
              {formatGi(group.memoryMi * BYTES_PER_MI)} Gi
            </span>
          </div>
        ))}
        {view.groups.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No sandbox is holding compute.
          </p>
        )}
      </div>
    </div>
  );
}
