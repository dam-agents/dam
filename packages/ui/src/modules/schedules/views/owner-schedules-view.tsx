import { ChevronRight, Time, WarningAlt } from "@carbon/icons-react";

import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { formatDateTime, timeUntil } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { useOwnerSchedules } from "../api/queries.js";
import {
  type OwnerScheduleRow,
  ownerScheduleRows,
} from "../lib/owner-schedules.js";
import {
  formatRunTime,
  lastRunStatus,
  scheduleCadenceText,
} from "../lib/schedule-format.js";

export function OwnerSchedulesView() {
  const { data, isLoading, isError } = useOwnerSchedules();
  const agents = useAgentsList();
  const rows = ownerScheduleRows(data ?? [], agents);

  return (
    <div className="anim-in">
      <PageHeader
        title="Schedules"
        description="Everything that runs on its own across your agents. Open one to change, pause or delete it in its agent."
      />

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {isError && (
        <Callout tone="danger">
          <p className="text-sm text-danger font-semibold mb-1">
            Couldn't load schedules
          </p>
          <p className="text-xs text-muted-foreground">
            The server returned an error. Try again or check your network
            connection.
          </p>
        </Callout>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <Callout inset className="bg-card">
          <p className="py-4 text-center text-sm text-foreground/80">
            None of your agents has a schedule yet. Set one up in an agent's
            Schedules section, or ask the agent in chat.
          </p>
        </Callout>
      )}

      {rows.length > 0 && (
        <ul className="space-y-2" aria-label="Schedules">
          {rows.map((row) => (
            <OwnerScheduleItem key={row.schedule.id} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}

function OwnerScheduleItem({ row }: { row: OwnerScheduleRow }) {
  const { schedule, agentName, active, problem } = row;
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const cadence = scheduleCadenceText(schedule);
  const nextRun = active ? schedule.status?.nextRun : undefined;
  const lastRun = schedule.status?.lastRun;
  const outcome = lastRunStatus(schedule.status?.lastResult);
  const idle = schedule.type === "once" ? "Finished" : "Paused";

  return (
    <li>
      <Card className="hover:bg-muted">
        <button
          type="button"
          onClick={() => navigateToSandboxHome(schedule.agentId, "schedules")}
          className="flex w-full items-center gap-3 p-4 text-left"
        >
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground">
              <span className="truncate">{schedule.name}</span>
              {problem && (
                <WarningAlt size={16} className="shrink-0 text-destructive" />
              )}
            </p>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {agentName}
              {cadence && ` · ${cadence}`}
              {schedule.createdBy === "agent" && " · set up by the agent"}
            </p>
            {problem ? (
              <p className="mt-0.5 truncate text-sm text-destructive">
                {problem}
              </p>
            ) : (
              lastRun &&
              outcome && (
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  Last run {formatRunTime(lastRun)} ·{" "}
                  <span className={outcome.className}>{outcome.label}</span>
                </p>
              )
            )}
          </div>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-sm",
              nextRun ? "text-foreground" : "text-muted-foreground",
            )}
            title={nextRun && `Next run: ${formatDateTime(nextRun)}`}
          >
            {nextRun ? (
              <>
                <Time size={12} /> {timeUntil(nextRun)}
              </>
            ) : active ? null : (
              idle
            )}
          </span>
          <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
        </button>
      </Card>
    </li>
  );
}
