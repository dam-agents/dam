import { Help } from "@carbon/icons-react";

import { Tooltip } from "@/components/ui/tooltip";
import { externalLinkProps } from "@/lib/external-link";
import { cn } from "@/lib/utils";

import { COMPUTE_REQUEST_URL } from "../../../constants.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
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
  return (
    <div className="flex flex-col gap-2">
      <p className="text-foreground">
        {segment.agentName && (
          <AgentAvatar
            name={segment.agentName}
            size={16}
            className="mr-1.5 inline-block align-text-bottom"
          />
        )}
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
          Compute allocated
          <Tooltip
            content="What your running agents reserve, not what they are using. Stop or pause an agent to free up compute."
            side="bottom"
          >
            <Help size={14} className="cursor-help text-muted-foreground/60" />
          </Tooltip>
        </span>
        <a
          href={links?.computeRequest ?? COMPUTE_REQUEST_URL}
          {...externalLinkProps}
          className="shrink-0 text-muted-foreground/60 hover:underline"
        >
          Request more
        </a>
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
                    STATE_DOT[group.state],
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
