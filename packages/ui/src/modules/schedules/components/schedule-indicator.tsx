import {
  Add,
  ChevronDown,
  ChevronUp,
  Close,
  Launch,
  OverflowMenuVertical,
  Time,
} from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { formatDateTime, timeUntil } from "@/lib/format-time";

import { useStore } from "../../../store.js";
import type { Schedule } from "../../../types.js";
import { useAgentDisplayName } from "../../agents/api/queries.js";
import {
  useDeleteSchedule,
  useResetScheduleSession,
  useToggleSchedule,
} from "../api/mutations.js";
import { useSchedules } from "../api/queries.js";
import { ScheduleFormModal } from "../forms/schedule-form-modal.js";
import { useScheduleEditGuard } from "../hooks/use-schedule-edit-guard.js";
import { scheduleCadenceText } from "../lib/schedule-format.js";
import { ScheduleDetails } from "./schedule-details.js";
import { ScheduleResultsModal } from "./schedule-results-modal.js";

interface Props {
  agentId: string;
  onManage?: () => void;
}

export function ScheduleIndicator({ agentId, onManage }: Props) {
  const { data: schedules } = useSchedules(agentId);
  const count = schedules?.length ?? 0;
  const activeCount = schedules?.filter((s) => s.enabled).length ?? 0;

  const [formState, setFormState] = useState<
    { mode: "create" } | { mode: "edit"; schedule: Schedule } | null
  >(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resultsFor, setResultsFor] = useState<Schedule | null>(null);

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <Time size={16} />
            {activeCount === 0
              ? "No schedules"
              : `${activeCount} schedule${activeCount === 1 ? "" : "s"}`}
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          className="flex w-[380px] flex-col gap-0 p-0"
        >
          <div className="flex items-center justify-between px-4 pt-4 pb-3">
            <h3 className="text-sm font-semibold text-foreground">Schedules</h3>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFormState({ mode: "create" })}
              >
                <Add size={16} />
                New
              </Button>
              <PopoverClose asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Close"
                  className="shrink-0 text-muted-foreground"
                >
                  <Close size={16} />
                </Button>
              </PopoverClose>
            </div>
          </div>

          {count === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted-foreground">
              No schedules yet. Create one to automate this agent.
            </p>
          ) : (
            <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto px-3 pb-3">
              {schedules!.map((schedule) => (
                <PanelScheduleCard
                  key={schedule.id}
                  schedule={schedule}
                  isExpanded={expandedId === schedule.id}
                  onToggleExpanded={() =>
                    setExpandedId((prev) =>
                      prev === schedule.id ? null : schedule.id,
                    )
                  }
                  onEdit={() => setFormState({ mode: "edit", schedule })}
                  onViewResults={() => setResultsFor(schedule)}
                />
              ))}
            </div>
          )}

          {onManage && (
            <div className="border-t border-border px-4 py-3">
              <PopoverClose asChild>
                <Button variant="outline" size="sm" onClick={onManage}>
                  Manage
                </Button>
              </PopoverClose>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {formState?.mode === "create" && (
        <ScheduleFormModal
          agentId={agentId}
          onClose={() => setFormState(null)}
          onSaved={() => setFormState(null)}
        />
      )}
      {formState?.mode === "edit" && (
        <ScheduleFormModal
          agentId={agentId}
          existing={formState.schedule}
          onClose={() => setFormState(null)}
          onSaved={() => setFormState(null)}
        />
      )}
      {resultsFor && (
        <ScheduleResultsModal
          agentId={agentId}
          schedule={resultsFor}
          onClose={() => setResultsFor(null)}
        />
      )}
    </>
  );
}

function PanelScheduleCard({
  schedule,
  isExpanded,
  onToggleExpanded,
  onEdit,
  onViewResults,
}: {
  schedule: Schedule;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onEdit: () => void;
  onViewResults: () => void;
}) {
  const { id, name, enabled, sessionMode, status } = schedule;
  const showConfirm = useStore((s) => s.showConfirm);
  const sandboxName = useAgentDisplayName(schedule.agentId);
  const toggleSchedule = useToggleSchedule();
  const deleteSchedule = useDeleteSchedule();
  const resetScheduleSession = useResetScheduleSession();
  const guardEdit = useScheduleEditGuard();

  const cadence = scheduleCadenceText(schedule);
  const nextRunHint =
    enabled && status?.nextRun ? timeUntil(status.nextRun) : null;

  const handleEdit = () => void guardEdit(schedule, sandboxName, onEdit);

  const handleDelete = async () => {
    if (
      await showConfirm(
        "Are you sure you want to delete this schedule?",
        `Delete ${name}?`,
        { kind: "destructive", confirmLabel: "Delete Schedule" },
      )
    )
      deleteSchedule.mutate({ id });
  };

  const handleReset = async () => {
    if (
      await showConfirm(
        `Reset the session for "${name}"? The next run starts a fresh conversation.`,
        "Reset session",
        { confirmLabel: "Reset session" },
      )
    )
      resetScheduleSession.mutate({ id });
  };

  return (
    <Card>
      <div className="flex items-center gap-3 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-foreground">
            {name}
          </p>
          <div className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
            {cadence && <span className="truncate">{cadence}</span>}
            {nextRunHint && (
              <>
                <span aria-hidden>·</span>
                <span
                  className="inline-flex items-center gap-1 whitespace-nowrap"
                  title={
                    status?.nextRun
                      ? `Next run: ${formatDateTime(status.nextRun)}`
                      : undefined
                  }
                >
                  <Time size={12} /> {nextRunHint}
                </span>
              </>
            )}
          </div>
        </div>

        <Button variant="outline" size="sm" onClick={onViewResults}>
          <Launch size={14} /> Results
        </Button>

        <Switch
          checked={enabled}
          onCheckedChange={() => toggleSchedule.mutate({ id })}
          label={enabled ? "Disable schedule" : "Enable schedule"}
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label="Schedule actions"
            >
              <OverflowMenuVertical size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={handleEdit}>
              Edit schedule
            </DropdownMenuItem>
            {sessionMode === "continuous" && (
              <DropdownMenuItem onSelect={handleReset}>
                Reset session
              </DropdownMenuItem>
            )}
            <DropdownMenuItem tone="danger" onSelect={handleDelete}>
              Delete schedule
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <button
        type="button"
        onClick={onToggleExpanded}
        className="flex w-full items-center gap-1 border-t border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
      >
        {isExpanded ? (
          <>
            Hide details <ChevronUp size={14} />
          </>
        ) : (
          <>
            View details <ChevronDown size={14} />
          </>
        )}
      </button>

      {isExpanded && <ScheduleDetails schedule={schedule} />}
    </Card>
  );
}
