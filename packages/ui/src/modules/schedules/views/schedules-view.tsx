import {
  CheckmarkFilled,
  ErrorFilled,
  OverflowMenuVertical,
  Time,
} from "@carbon/icons-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { CARD_SURFACE } from "../../../components/ui/card.js";
import { useStore } from "../../../store.js";
import type { Schedule } from "../../../types.js";
import { useAgents, useAgentsList } from "../../agents/api/queries.js";
import {
  useDeleteSchedule,
  useResetScheduleSession,
  useToggleSchedule,
} from "../api/mutations.js";
import { useOwnerSchedules } from "../api/queries.js";
import { ScheduleResultsModal } from "../components/schedule-results-modal.js";
import { ScheduleFormModal } from "../forms/schedule-form-modal.js";
import { useScheduleEditGuard } from "../hooks/use-schedule-edit-guard.js";
import {
  formatRunTime,
  lastRunStatus,
  scheduleCadenceText,
} from "../lib/schedule-format.js";

interface AgentGroup {
  agentId: string;
  agentName: string;
  schedules: Schedule[];
}

export function SchedulesView() {
  const { data: schedules, isPending: schedulesPending } = useOwnerSchedules();
  const agents = useAgentsList();
  const { isPending: agentsPending } = useAgents();
  const setView = useStore((s) => s.setView);

  const [editing, setEditing] = useState<Schedule | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewingResults, setViewingResults] = useState<Schedule | null>(null);

  const loading = schedulesPending || agentsPending;
  const live = new Set(agents.map((a) => a.id));
  const liveSchedules = (schedules ?? []).filter((s) => live.has(s.agentId));

  const groups = useMemo<AgentGroup[]>(() => {
    const byAgent = new Map<string, Schedule[]>();
    for (const s of liveSchedules) {
      const list = byAgent.get(s.agentId) ?? [];
      list.push(s);
      byAgent.set(s.agentId, list);
    }
    return Array.from(byAgent.entries()).map(([agentId, scheds]) => ({
      agentId,
      agentName:
        agents.find((a) => a.id === agentId)?.name ?? agentId.slice(0, 8),
      schedules: scheds,
    }));
  }, [liveSchedules, agents]);

  const hasSchedules = !loading && liveSchedules.length > 0;

  if (loading) {
    return (
      <div className="anim-in">
        <PageHeader title="Schedules" />
        <ListSkeleton rows={3} rowHeight={90} />
      </div>
    );
  }

  if (!hasSchedules) {
    return (
      <div className="anim-in">
        <PageHeader
          title="No schedules yet"
          description={
            <span className="inline-block max-w-[560px]">
              A schedule wakes an agent on a cadence you set — every morning,
              every Monday, or whenever you need. Create an agent first, then
              add schedules to automate its work.
            </span>
          }
          actions={<Button onClick={() => setView("home")}>Go to home</Button>}
        />
      </div>
    );
  }

  return (
    <div className="anim-in">
      <PageHeader
        title="Schedules"
        description="Schedules wake your agents on a cadence and give them a task. Each run creates a session you can review."
        actions={
          <Button
            disabled={agents.length === 0}
            onClick={() => setCreating(true)}
          >
            Create schedule
          </Button>
        }
      />

      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <AgentScheduleGroup
            key={group.agentId}
            group={group}
            onEdit={setEditing}
            onViewResults={setViewingResults}
          />
        ))}
      </div>

      {editing && (
        <ScheduleFormModal
          agentId={editing.agentId}
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}

      {creating && (
        <ScheduleFormModal
          agentChoices={agents.map((a) => ({ id: a.id, name: a.name }))}
          onClose={() => setCreating(false)}
          onSaved={() => setCreating(false)}
        />
      )}

      {viewingResults && (
        <ScheduleResultsModal
          agentId={viewingResults.agentId}
          schedule={viewingResults}
          onClose={() => setViewingResults(null)}
          onResumeSession={(sessionId) => {
            const store = useStore.getState();
            store.openAgentSession(viewingResults.agentId, sessionId);
          }}
        />
      )}
    </div>
  );
}

function AgentScheduleGroup({
  group,
  onEdit,
  onViewResults,
}: {
  group: AgentGroup;
  onEdit: (schedule: Schedule) => void;
  onViewResults: (schedule: Schedule) => void;
}) {
  const openAgentSession = useStore((s) => s.openAgentSession);

  return (
    <div>
      <button
        type="button"
        onClick={() => openAgentSession(group.agentId)}
        className="mb-3 text-sm font-semibold text-foreground transition-colors hover:text-primary"
      >
        {group.agentName}
      </button>

      <div className="flex flex-col gap-2">
        {group.schedules.map((schedule) => (
          <ScheduleRow
            key={schedule.id}
            schedule={schedule}
            agentName={group.agentName}
            onEdit={() => onEdit(schedule)}
            onViewResults={() => onViewResults(schedule)}
          />
        ))}
      </div>
    </div>
  );
}

function ScheduleRow({
  schedule,
  agentName,
  onEdit,
  onViewResults,
}: {
  schedule: Schedule;
  agentName: string;
  onEdit: () => void;
  onViewResults: () => void;
}) {
  const { id, name, enabled, sessionMode, status } = schedule;
  const showConfirm = useStore((s) => s.showConfirm);
  const toggleSchedule = useToggleSchedule();
  const deleteSchedule = useDeleteSchedule();
  const resetScheduleSession = useResetScheduleSession();
  const guardEdit = useScheduleEditGuard();

  const cadence = scheduleCadenceText(schedule);
  const runStatus = lastRunStatus(status?.lastResult);
  const lastRunTime = status?.lastRun ? formatRunTime(status.lastRun) : null;
  const nextRunTime = status?.nextRun ? formatRunTime(status.nextRun) : null;

  const handleEdit = () => void guardEdit(schedule, agentName, onEdit);

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
    <div className={cn(CARD_SURFACE, "p-4")}>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <p className="text-[15px] font-semibold text-foreground">{name}</p>
            {!enabled && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[13px] font-medium text-muted-foreground">
                Paused
              </span>
            )}
          </div>

          {cadence && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Time size={14} className="shrink-0" />
              {cadence}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
            {lastRunTime && (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="font-medium text-foreground/80">
                  Last run:
                </span>
                {lastRunTime}
                {runStatus && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1",
                      runStatus.className,
                    )}
                  >
                    {runStatus.label === "Succeeded" ? (
                      <CheckmarkFilled size={14} />
                    ) : (
                      <ErrorFilled size={14} />
                    )}
                    <span className="text-[13px]">{runStatus.label}</span>
                  </span>
                )}
              </span>
            )}
            {nextRunTime && enabled && (
              <span className="text-muted-foreground">
                <span className="font-medium text-foreground/80">
                  Next run:
                </span>{" "}
                {nextRunTime}
              </span>
            )}
          </div>

          {schedule.task && (
            <p className="mt-2 line-clamp-2 text-sm text-muted-foreground/80">
              {schedule.task}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={onViewResults}>
            View runs
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
      </div>
    </div>
  );
}
