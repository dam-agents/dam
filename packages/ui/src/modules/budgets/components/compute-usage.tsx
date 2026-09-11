import { Help } from "@carbon/icons-react";

import { Card } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { externalLinkProps } from "@/lib/external-link";
import { cn } from "@/lib/utils";

import { COMPUTE_REQUEST_URL } from "../../../constants.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useLinks } from "../../links/api/queries.js";
import { useBudgetReserved } from "../api/queries.js";
import { formatCores, formatGi } from "../lib/format.js";
import {
  BYTES_PER_MI,
  type ComputeCellState,
  type ComputeSegment,
  computeView,
  formatSizeLabel,
  type SlotUnit,
  slotUnitOf,
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

function segmentLabel(segment: ComputeSegment, unit: SlotUnit): string {
  if (segment.state === "available")
    return `${segment.slots} ${segment.slots === 1 ? "slot" : "slots"} available`;
  return `${segment.agentName} · ${formatSizeLabel(
    { cpuMilli: segment.cpuMilli, memoryMi: segment.memoryMi },
    unit,
  )}${segment.alwaysOn ? ", always on" : ""}`;
}

function HeldSegmentCard({ segment }: { segment: ComputeSegment }) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  return (
    <div className="flex flex-col gap-1">
      <p>
        <span className="font-semibold">{segment.agentName}</span> (
        {formatCores(segment.cpuMilli)} CPU ·{" "}
        {formatGi(segment.memoryMi * BYTES_PER_MI)} Gi)
      </p>
      {segment.alwaysOn && (
        <>
          <p className="text-muted-foreground">
            Always on — holds compute even while idle.
          </p>
          <button
            type="button"
            className="self-end text-accent hover:underline"
            onClick={() =>
              segment.agentId && navigateToSandboxHome(segment.agentId, "setup")
            }
          >
            Manage
          </button>
        </>
      )}
    </div>
  );
}

interface Props {
  agents: readonly AgentView[];
  workingAgentIds: ReadonlySet<string>;
}

export function ComputeUsage({ agents, workingAgentIds }: Props) {
  const { data: budget } = useBudgetReserved();
  const { data: links } = useLinks();
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  if (!budget) return null;

  const unit = slotUnitOf(budget);
  const view = computeView(
    agents.filter((a) => a.state === "running"),
    workingAgentIds,
    budget,
  );

  return (
    <>
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 text-foreground">
          Compute resources
          <Tooltip
            content="What your running agents reserve, not what they are using. Stop or pause an agent to free up compute."
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
          content={(segment) => <HeldSegmentCard segment={segment} />}
          onActivate={(segment) => {
            if (segment.agentId)
              navigateToSandboxHome(segment.agentId, "setup");
          }}
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
