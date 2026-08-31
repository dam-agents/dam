import { Help, Lightning } from "@carbon/icons-react";
import { useMemo, useState } from "react";

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
import { parseCpuMilli, parseMemoryMi } from "../../sandboxes/lib/quantity.js";
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

type CellHighlight =
  | { kind: "agent"; agentId: string }
  | { kind: "state"; state: ComputeCellState }
  | { kind: "agentSet"; ids: ReadonlySet<string> }
  | null;

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

function isHighlighted(cell: ComputeCell, highlight: CellHighlight): boolean {
  if (!highlight) return false;
  switch (highlight.kind) {
    case "agent":
      return cell.agentId
        ? cell.agentId === highlight.agentId
        : highlight.agentId === "__available";
    case "state":
      return cell.state === highlight.state;
    case "agentSet":
      return cell.agentId ? highlight.ids.has(cell.agentId) : false;
  }
}

function isDimmed(cell: ComputeCell, highlight: CellHighlight): boolean {
  return highlight ? !isHighlighted(cell, highlight) : false;
}

function isGroupDimmed(
  groupState: ComputeCellState,
  highlight: CellHighlight,
): boolean {
  if (!highlight) return false;
  if (highlight.kind === "state") return highlight.state !== groupState;
  if (highlight.kind === "agentSet" || highlight.kind === "agent") return true;
  return false;
}

export function ComputeWidget({ runningAgents, workingAgentIds }: Props) {
  const { data } = useBudgetReserved();
  const { data: links } = useLinks();
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
        {view.cells.map((cell, index) => (
          <Tooltip key={index} content={cellTitle(cell)} side="bottom">
            <button
              type="button"
              aria-label={cellTitle(cell)}
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
          </Tooltip>
        ))}
      </div>

      <div className="space-y-2">
        {view.groups.map((group) => (
          <button
            key={group.state}
            type="button"
            className={cn(
              "flex w-full items-center justify-between rounded px-1 -mx-1 text-sm text-muted-foreground outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-foreground/30",
              isGroupDimmed(group.state, highlight) && "opacity-30",
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
              {group.agents} {group.agents === 1 ? "agent" : "agents"} ·{" "}
              {formatCores(group.cpuMilli)} CPU ·{" "}
              {formatGi(group.memoryMi * BYTES_PER_MI)} Gi
            </span>
          </button>
        ))}
        {view.groups.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No agent is holding compute.
          </p>
        )}
        <AlwaysOnAnnotation
          agents={runningAgents}
          highlight={highlight}
          onHighlight={setHighlight}
        />
      </div>
    </div>
  );
}

function AlwaysOnAnnotation({
  agents,
  highlight,
  onHighlight,
}: {
  agents: readonly AgentView[];
  highlight: CellHighlight;
  onHighlight: (h: CellHighlight) => void;
}) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const alwaysOn = agents.filter((a) => a.hibernationTimeoutMin === 0);
  const alwaysOnIds = useMemo(
    () => new Set(alwaysOn.map((a) => a.id)),
    [alwaysOn],
  );
  if (alwaysOn.length === 0) return null;

  const cpuMilli = alwaysOn.reduce(
    (sum, a) => sum + (parseCpuMilli(a.size.cpu) ?? 0),
    0,
  );
  const memoryMi = alwaysOn.reduce(
    (sum, a) => sum + (parseMemoryMi(a.size.memory) ?? 0),
    0,
  );

  const dimmed =
    highlight !== null &&
    (highlight.kind !== "agentSet" || highlight.ids !== alwaysOnIds);

  return (
    <div
      className={cn(
        "flex items-center justify-between border-t border-border pt-2 text-sm text-muted-foreground transition-opacity duration-150",
        dimmed && "opacity-30",
      )}
    >
      <HoverCard openDelay={150} closeDelay={300}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            className="flex cursor-pointer items-center gap-2 rounded px-1 -mx-1 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/30"
            onMouseEnter={() =>
              onHighlight({ kind: "agentSet", ids: alwaysOnIds })
            }
            onMouseLeave={() => onHighlight(null)}
            onFocus={() =>
              onHighlight({ kind: "agentSet", ids: alwaysOnIds })
            }
            onBlur={() => onHighlight(null)}
          >
            <Lightning size={16} className="shrink-0 text-accent" />
            {alwaysOn.length} always-on
          </button>
        </HoverCardTrigger>
        <HoverCardContent side="top" className="w-64 p-3">
          <p className="mb-2 text-sm text-muted-foreground">
            Always-on — holds compute even while idle.
          </p>
          <div className="space-y-1">
            {alwaysOn.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between text-sm"
              >
                <span className="font-medium text-foreground">{a.name}</span>
                <button
                  type="button"
                  onClick={() => navigateToSandboxHome(a.id, "setup")}
                  className="text-accent transition-colors hover:text-foreground"
                >
                  Manage
                </button>
              </div>
            ))}
          </div>
        </HoverCardContent>
      </HoverCard>
      <span className="tabular-nums">
        {formatCores(cpuMilli)} CPU · {formatGi(memoryMi * BYTES_PER_MI)} Gi
        held
      </span>
    </div>
  );
}
