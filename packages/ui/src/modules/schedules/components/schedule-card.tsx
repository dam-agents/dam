import {
  Edit,
  OverflowMenuVertical,
  Pause,
  Play,
  Share,
  Time,
  TrashCan,
} from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { CARD_HOVER, CARD_SURFACE } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { Schedule } from "../../../types.js";
import { useAgentDisplayName } from "../../agents/api/queries.js";
import {
  useDeleteSchedule,
  useResetScheduleSession,
  useToggleSchedule,
} from "../api/mutations.js";
import { useScheduleEditGuard } from "../hooks/use-schedule-edit-guard.js";
import { formatRunTime, scheduleCadenceText } from "../lib/schedule-format.js";

interface Props {
  schedule: Schedule;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onEdit: () => void;
  onViewResults: () => void;
}

export function ScheduleCard({ schedule, onEdit, onViewResults }: Props) {
  const { id, name, enabled, sessionMode, status } = schedule;
  const showConfirm = useStore((s) => s.showConfirm);
  const sandboxName = useAgentDisplayName(schedule.agentId);
  const toggleSchedule = useToggleSchedule();
  const deleteSchedule = useDeleteSchedule();
  const resetScheduleSession = useResetScheduleSession();
  const guardEdit = useScheduleEditGuard();

  const cadence = scheduleCadenceText(schedule);
  const nextRunTime = status?.nextRun ? formatRunTime(status.nextRun) : null;

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

  const subtitle = [
    cadence,
    nextRunTime && enabled ? `Next ${nextRunTime}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={cn(
        CARD_SURFACE,
        CARD_HOVER,
        "group flex items-center gap-4 rounded-xl px-4 py-3",
      )}
    >
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          enabled
            ? "bg-blue-100/50 text-accent dark:bg-blue-950/50"
            : "bg-muted text-muted-foreground",
        )}
      >
        {enabled ? <Time size={16} /> : <Pause size={16} />}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-foreground">
          {name}
        </p>
        {subtitle && (
          <p className="truncate text-[14px] text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
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
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={handleEdit}>
              <Edit size={16} className="mr-2.5 text-muted-foreground" />
              Edit schedule
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onViewResults}>
              <Play size={16} className="mr-2.5 text-muted-foreground" />
              View runs
            </DropdownMenuItem>
            {sessionMode === "continuous" && (
              <DropdownMenuItem onSelect={handleReset}>
                <Share size={16} className="mr-2.5 text-muted-foreground" />
                Reset session
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem tone="danger" onSelect={handleDelete}>
              <TrashCan size={16} className="mr-2.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
