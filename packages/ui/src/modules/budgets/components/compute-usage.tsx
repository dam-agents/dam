import { Help } from "@carbon/icons-react";
import { Fragment } from "react";

import { Card } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { externalLinkProps } from "@/lib/external-link";
import { cn } from "@/lib/utils";

import { COMPUTE_REQUEST_URL } from "../../../constants.js";
import type { AgentView } from "../../../types.js";
import { useLinks } from "../../links/api/queries.js";
import { useBudgetReserved } from "../api/queries.js";
import { formatCores, formatGi } from "../lib/format.js";
import {
  type ComputeCellState,
  type ComputeSegment,
  computeView,
  consumers,
} from "../lib/slots.js";
import { SlotBar } from "./slot-bar.js";

type HeldState = Exclude<ComputeCellState, "available">;

const STATE_DOT: Record<HeldState, string> = {
  running: "bg-success",
  awake: "bg-accent",
};

const STATE_LABEL: Record<HeldState, string> = {
  running: "running",
  awake: "awake",
};

function segmentLabel(segment: ComputeSegment): string {
  if (segment.state === "available") return `room for ${segment.slots} more`;
  return `${segment.agentName} · ${STATE_LABEL[segment.state]}`;
}

interface Props {
  agents: readonly AgentView[];
  workingAgentIds: ReadonlySet<string>;
}

export function ComputeUsage({ agents, workingAgentIds }: Props) {
  const { data: budget } = useBudgetReserved();
  const { data: links } = useLinks();
  if (!budget) return null;

  const running = agents.filter((a) => a.state === "running");
  const view = computeView(running, workingAgentIds, budget);
  const heaviest = consumers(running, workingAgentIds).slice(0, 4);

  return (
    <>
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 text-foreground">
          Compute
          <Tooltip
            content="How many agents you can have awake at once, and what they are using right now. Sizing is the platform's job — you stop an agent you are done with, or ask for a bigger allowance."
            side="bottom"
          >
            <Help size={14} className="cursor-help text-muted-foreground/60" />
          </Tooltip>
        </span>
        <span className="tabular-nums text-foreground">
          {view.usedSlots} of {view.ceilingSlots} agents awake
        </span>
      </div>
      <div className="mb-3">
        <SlotBar
          segments={view.segments}
          totalSlots={view.totalSlots}
          label={segmentLabel}
          ariaLabel="Agents awake"
        />
      </div>
      {heaviest.length > 0 && (
        <dl className="mb-3 grid grid-cols-[1fr_auto_auto] items-baseline gap-x-4 gap-y-1 text-sm">
          {heaviest.map((c) => (
            <Fragment key={c.agentId}>
              <dt className="truncate text-muted-foreground">{c.agentName}</dt>
              <dd className="tabular-nums text-foreground">
                {formatGi(c.memoryBytes)} Gi
              </dd>
              <dd className="tabular-nums text-muted-foreground">
                {c.cpuMilli === null ? "—" : `${formatCores(c.cpuMilli)} cores`}
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          {view.groups.length === 0 && "No agent is awake."}
          {view.groups.map((group) => (
            <span key={group.state} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-block size-2 shrink-0 rounded-sm",
                  STATE_DOT[group.state],
                )}
              />
              {group.agents} {STATE_LABEL[group.state]}
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

export function ComputeUsageCard(props: Props) {
  return (
    <Card className="mb-8 border border-border p-4">
      <ComputeUsage {...props} />
    </Card>
  );
}
