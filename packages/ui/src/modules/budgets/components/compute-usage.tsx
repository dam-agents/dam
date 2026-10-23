import { Information } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { formatGi } from "../../../lib/format-size.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import { useBudgetReserved } from "../api/queries.js";
import { formatCores } from "../lib/format.js";
import {
  BYTES_PER_MI,
  type ComputeCellState,
  type ComputeSegment,
  computeView,
  formatSizeLabel,
  type SlotUnit,
  slotUnitOf,
} from "../lib/slots.js";
import { SEGMENT_FILL, SlotBar } from "./slot-bar.js";

type HeldState = Exclude<ComputeCellState, "available">;

const STATE_LABEL: Record<HeldState, string> = {
  running: "Working",
  awake: "Idle",
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
  const agents = useAgentsList();
  return (
    <div className="flex flex-col gap-2">
      <p className="text-foreground">
        {segment.agentName && (
          <AgentAvatar
            name={segment.agentName}
            avatar={agents.find((a) => a.id === segment.agentId)?.avatar}
            size={16}
            className="mr-1.5 inline-block align-text-bottom"
          />
        )}
        <span className="font-semibold">{segment.agentName}</span> (
        {formatCores(segment.cpuMilli)} CPU ·{" "}
        {formatGi(segment.memoryMi * BYTES_PER_MI)} GiB)
      </p>
      {segment.alwaysOn && (
        <>
          <p className="text-muted-foreground">
            Always on — holds compute even while idle.
          </p>
          <Button
            variant="link"
            size="inline"
            className="self-end"
            onClick={() =>
              segment.agentId && navigateToSandboxHome(segment.agentId, "setup")
            }
          >
            Manage
          </Button>
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
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  if (!budget) return null;

  const unit = slotUnitOf(budget);
  const view = computeView(agents, workingAgentIds, budget);

  return (
    <>
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 text-foreground">
          Compute allocated
          <Tooltip
            content="What your running agents reserve, not what they are using. Disable an agent you aren't using to free up compute."
            side="bottom"
          >
            <Information
              size={14}
              className="cursor-help text-muted-foreground/60"
            />
          </Tooltip>
        </span>
      </div>
      <div className="mb-3">
        <p className="text-2xl font-semibold tabular-nums text-foreground">
          {view.usedSlots}/{view.ceilingSlots}
        </p>
        <p className="text-sm text-muted-foreground">Slots</p>
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
      {view.groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No agent is holding compute.
        </p>
      ) : (
        <div className="divide-y divide-border border-t border-border text-sm text-muted-foreground">
          {view.groups.map((group) => (
            <div
              key={group.state}
              className="flex items-center justify-between gap-3 py-2"
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "inline-block size-2 shrink-0 rounded-full",
                    SEGMENT_FILL[group.state],
                  )}
                />
                {STATE_LABEL[group.state]}
              </span>
              <span>
                {group.agents} {group.agents === 1 ? "agent" : "agents"}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
