import { ChevronRight, Time, WarningAlt } from "@carbon/icons-react";
import { CalendarEvent } from "@carbon/pictograms-react";

import { ListSection } from "@/components/ui/list-section";
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
import { runOutcomeLine, scheduleCadenceText } from "../lib/schedule-format.js";

export function OwnerSchedulesView() {
  const { data, isLoading, isError } = useOwnerSchedules();
  const agents = useAgentsList();
  const rows = ownerScheduleRows(data ?? [], agents);

  return (
    <div>
      <PageHeader
        pictogram={<CalendarEvent aria-hidden />}
        title="Schedules"
        description="See everything that runs on its own across your agents. Open one to change, pause or delete it."
      />

      <ListSection
        loading={isLoading}
        error={isError && "Couldn't load schedules."}
        isEmpty={rows.length === 0}
        empty="None of your agents has a schedule yet. Set one up in an agent's Schedules section, or ask the agent in chat."
      >
        {rows.map((row) => (
          <OwnerScheduleItem key={row.schedule.id} row={row} />
        ))}
      </ListSection>
    </div>
  );
}

function OwnerScheduleItem({ row }: { row: OwnerScheduleRow }) {
  const { schedule, agentName, active, problem } = row;
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const cadence = scheduleCadenceText(schedule);
  const nextRun = active ? schedule.status?.nextRun : undefined;
  const outcome = runOutcomeLine(schedule);
  const idle = schedule.type === "once" ? "Finished" : "Paused";

  return (
    <button
      type="button"
      onClick={() => navigateToSandboxHome(schedule.agentId, "schedules")}
      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-md font-medium text-foreground">
          <span className="truncate">{schedule.name}</span>
          {problem && <WarningAlt size={16} className="shrink-0 text-danger" />}
        </p>
        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
          {agentName}
          {cadence && ` · ${cadence}`}
          {schedule.createdBy === "agent" && " · set up by the agent"}
        </p>
        {problem ? (
          <p className="mt-0.5 line-clamp-2 text-sm text-danger">{problem}</p>
        ) : (
          outcome && (
            <p
              className="mt-0.5 line-clamp-2 text-sm text-muted-foreground"
              title={outcome.label}
            >
              {outcome.when ? `Last run ${outcome.when} · ` : ""}
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
  );
}
