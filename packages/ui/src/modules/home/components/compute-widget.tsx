import { Help } from "@carbon/icons-react";
import { useState } from "react";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Tooltip } from "@/components/ui/tooltip";
import { externalLinkProps } from "@/lib/external-link";
import { cn } from "@/lib/utils";

import { COMPUTE_REQUEST_URL } from "../../../constants.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useBudgetReserved } from "../../budgets/api/queries.js";
import { formatCores, formatGi } from "../../budgets/lib/format.js";
import { useLinks } from "../../links/api/queries.js";
import {
  type ComputeCell,
  type ComputeCellState,
  computeView,
} from "../lib/compute-cells.js";

const BYTES_PER_MI = 1024 ** 2;

const STATE_LABEL: Record<Exclude<ComputeCellState, "available">, string> = {
  running: "Working",
  awake: "Idle",
};

const STATE_DOT: Record<Exclude<ComputeCellState, "available">, string> = {
  running: "bg-success",
  awake: "bg-accent",
};

type CellHighlight =
  | { kind: "agent"; agentId: string }
  | { kind: "state"; state: ComputeCellState }
  | null;

interface Props {
  runningAgents: readonly AgentView[];
  workingAgentIds: ReadonlySet<string>;
}

function cellLabel(cell: ComputeCell): string {
  if (cell.state === "available") return "Available";
  return `${cell.agentName} (${formatCores(cell.cpuMilli)} CPU · ${formatGi(cell.memoryMi * BYTES_PER_MI)} Gi)`;
}

function isHighlighted(cell: ComputeCell, highlight: CellHighlight): boolean {
  if (!highlight) return false;
  switch (highlight.kind) {
    case "agent":
      return cell.agentId
        ? cell.agentId === highlight.agentId
        : highlight.agentId === "__available";
    case "state":
      return cell.state === highlight.state;
  }
}

function isDimmed(cell: ComputeCell, highlight: CellHighlight): boolean {
  return highlight ? !isHighlighted(cell, highlight) : false;
}

function isGroupDimmed(
  groupState: ComputeCellState,
  highlight: CellHighlight,
  cells: readonly ComputeCell[],
): boolean {
  if (!highlight) return false;
  if (highlight.kind === "state") return highlight.state !== groupState;
  if (highlight.kind === "agent") {
    return !cells.some(
      (c) => c.agentId === highlight.agentId && c.state === groupState,
    );
  }
  return false;
}

export function ComputeWidget({ runningAgents, workingAgentIds }: Props) {
  const { data } = useBudgetReserved();
  const { data: links } = useLinks();
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const [highlight, setHighlight] = useState<CellHighlight>(null);
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
            content="What your running agents reserve, not what they are using. Stop or pause an agent to free it."
            side="bottom"
          >
            <Help size={16} className="cursor-help text-muted-foreground/50" />
          </Tooltip>
        </span>
        <a
          href={links?.computeRequest ?? COMPUTE_REQUEST_URL}
          {...externalLinkProps}
          className="text-sm text-muted-foreground/60 transition-colors hover:text-muted-foreground"
        >
          Request more
        </a>
      </div>

      <p className="mb-1 text-[28px] leading-none font-bold tracking-tight text-foreground tabular-nums">
        {formatCores(view.usedMilli)}/{formatCores(view.ceilingMilli)}
      </p>
      <p className="mb-5 text-sm text-muted-foreground">CPU</p>

      <div
        className="mb-5 flex gap-0.5 [&>button]:flex-1"
        role="group"
        aria-label="Allocated CPU"
      >
        {view.cells.map((cell, index) => {
          const cellBtn = (
            <button
              type="button"
              aria-label={cellLabel(cell)}
              className={cn(
                "h-3 w-full outline-none transition-all duration-150",
                index === 0 && "rounded-l-full",
                index === view.cells.length - 1 && "rounded-r-full",
                cell.state === "running" && "bg-success",
                cell.state === "awake" && "bg-accent",
                cell.state === "available" &&
                  "border border-muted-foreground/25 bg-background",
                isHighlighted(cell, highlight) &&
                  "brightness-110 h-4 -my-0.5",
                isDimmed(cell, highlight) && "opacity-20",
                "focus-visible:brightness-110 focus-visible:h-4 focus-visible:-my-0.5",
              )}
              onMouseEnter={() =>
                setHighlight({
                  kind: "agent",
                  agentId: cell.agentId ?? "__available",
                })
              }
              onMouseLeave={() => setHighlight(null)}
              onFocus={() =>
                setHighlight({
                  kind: "agent",
                  agentId: cell.agentId ?? "__available",
                })
              }
              onBlur={() => setHighlight(null)}
            />
          );
          if (cell.alwaysOn) {
            return (
              <HoverCard key={index} openDelay={150} closeDelay={300}>
                <HoverCardTrigger asChild>{cellBtn}</HoverCardTrigger>
                <HoverCardContent side="top" className="w-64 p-3">
                  <p className="text-sm text-foreground">
                    <span className="font-semibold">{cell.agentName}</span>{" "}
                    ({formatCores(cell.cpuMilli)} CPU · {formatGi(cell.memoryMi * BYTES_PER_MI)} Gi)
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Always on — holds compute even while idle.
                  </p>
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() =>
                        cell.agentId &&
                        navigateToSandboxHome(cell.agentId, "setup")
                      }
                      className="text-sm text-accent transition-colors hover:text-foreground"
                    >
                      Manage
                    </button>
                  </div>
                </HoverCardContent>
              </HoverCard>
            );
          }
          if (cell.state === "available") {
            return (
              <Tooltip key={index} content="Available" side="top">
                {cellBtn}
              </Tooltip>
            );
          }
          return (
            <HoverCard key={index} openDelay={150} closeDelay={300}>
              <HoverCardTrigger asChild>{cellBtn}</HoverCardTrigger>
              <HoverCardContent side="top" className="w-auto whitespace-nowrap p-3">
                <p className="text-sm text-foreground">
                  <span className="font-semibold">{cell.agentName}</span>{" "}
                  ({formatCores(cell.cpuMilli)} CPU · {formatGi(cell.memoryMi * BYTES_PER_MI)} Gi)
                </p>
              </HoverCardContent>
            </HoverCard>
          );
        })}
      </div>

      <div className="space-y-2">
        {view.groups.map((group) => (
          <button
            key={group.state}
            type="button"
            className={cn(
              "flex w-full items-center justify-between rounded px-1 -mx-1 text-sm text-muted-foreground outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-foreground/30",
              isGroupDimmed(group.state, highlight, view.cells) && "opacity-30",
            )}
            onMouseEnter={() =>
              setHighlight({ kind: "state", state: group.state })
            }
            onMouseLeave={() => setHighlight(null)}
            onFocus={() =>
              setHighlight({ kind: "state", state: group.state })
            }
            onBlur={() => setHighlight(null)}
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
              {group.agents} {group.agents === 1 ? "agent" : "agents"}
            </span>
          </button>
        ))}
        {view.groups.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No agent is holding compute.
          </p>
        )}
      </div>
    </div>
  );
}

