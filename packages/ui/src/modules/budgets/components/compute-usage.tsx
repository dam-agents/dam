import { Help } from "@carbon/icons-react";

import { Card } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { externalLinkProps } from "@/lib/external-link";
import { cn } from "@/lib/utils";

import { COMPUTE_REQUEST_URL } from "../../../constants.js";
import type { AgentView } from "../../../types.js";
import { useFeed } from "../../home/api/queries.js";
import { useLinks } from "../../links/api/queries.js";
import { useBudgetReserved } from "../api/queries.js";
import {
  type ComputeCellState,
  type ComputeSegment,
  computeView,
  formatSizeLabel,
  type SlotUnit,
  slotUnitOf,
} from "../lib/slots.js";
import { SlotBar } from "./slot-bar.js";

const STATE_DOT: Record<Exclude<ComputeCellState, "available">, string> = {
  running: "bg-success",
  awake: "bg-accent",
};

function segmentLabel(segment: ComputeSegment, unit: SlotUnit): string {
  if (segment.state === "available")
    return `${segment.slots} ${segment.slots === 1 ? "slot" : "slots"} available`;
  return `${segment.agentName} · ${formatSizeLabel(
    { cpuMilli: segment.cpuMilli, memoryMi: segment.memoryMi },
    unit,
  )}`;
}

export function ComputeUsage({ agents }: { agents: readonly AgentView[] }) {
  const { data: budget } = useBudgetReserved();
  const { data: links } = useLinks();
  const { items } = useFeed();
  if (!budget) return null;

  const unit = slotUnitOf(budget);
  const view = computeView(
    agents.filter((a) => a.state === "running"),
    new Set(
      items.filter((i) => i.kind === "in-progress").map((i) => i.agentId),
    ),
    budget,
  );

  return (
    <>
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 text-foreground">
          Compute resources
          <Tooltip
            content="What your running agents reserve, not what they are using. Stop or pause an agent to free it."
            side="bottom"
          >
            <Help size={14} className="cursor-help text-muted-foreground/60" />
          </Tooltip>
        </span>
        <span className="tabular-nums text-foreground">
          {view.usedSlots}/{view.ceilingSlots} slots
        </span>
      </div>
      <div className="mb-3">
        <SlotBar
          segments={view.segments}
          totalSlots={view.totalSlots}
          label={(segment) => segmentLabel(segment, unit)}
          ariaLabel="Usage slots"
        />
      </div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          {view.groups.length === 0 && "No agent is holding compute."}
          {view.groups.map((group) => (
            <span key={group.state} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-block size-2 shrink-0 rounded-sm",
                  STATE_DOT[group.state],
                )}
              />
              {group.agents} {group.state}
            </span>
          ))}
        </span>
        <a
          href={links?.computeRequest ?? COMPUTE_REQUEST_URL}
          {...externalLinkProps}
          className="shrink-0 text-accent hover:underline"
        >
          Request more budget
        </a>
      </div>
    </>
  );
}

export function ComputeUsageCard({ agents }: { agents: readonly AgentView[] }) {
  return (
    <Card className="mb-8 border border-border p-4">
      <ComputeUsage agents={agents} />
    </Card>
  );
}
