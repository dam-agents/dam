import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { emitToast } from "@/lib/toast";

import { useStore } from "../../../store.js";
import type { Schedule } from "../../../types.js";
import { useAgentDisplayName } from "../../agents/api/queries.js";
import {
  useDeleteSchedule,
  useResetScheduleSession,
  useRunScheduleNow,
} from "../api/mutations.js";
import { useScheduleEditGuard } from "../hooks/use-schedule-edit-guard.js";
import { scheduleOnceState } from "../lib/once-schedule.js";
import {
  runNowConfirmText,
  runNowStartedText,
} from "../lib/schedule-format.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: A schedule's ⋮ menu, the same wherever a schedule
 * is listed — the Agent's Schedules section and the composer's + menu: Run now
 * and Edit while it can still run, Reset session for a continuous one, and
 * Delete. Each asks first where the Schedules section always has, and Edit
 * opens the schedule's editor through the guard that warns about an edit the
 * Agent cannot take now.
 */
export function ScheduleActionsMenu({
  schedule,
  onEdit,
}: {
  schedule: Schedule;
  onEdit: () => void;
}) {
  const { id, name, sessionMode } = schedule;
  const showConfirm = useStore((s) => s.showConfirm);
  const sandboxName = useAgentDisplayName(schedule.agentId);
  const deleteSchedule = useDeleteSchedule();
  const resetScheduleSession = useResetScheduleSession();
  const runScheduleNow = useRunScheduleNow();
  const guardEdit = useScheduleEditGuard();
  const onceState = scheduleOnceState(schedule);

  const handleEdit = () => void guardEdit(schedule, sandboxName, onEdit);

  const handleDelete = async () => {
    if (
      await showConfirm(
        "It stops running and cannot be recovered.",
        `Delete schedule “${name}”?`,
        { kind: "destructive", confirmLabel: "Delete schedule" },
      )
    )
      deleteSchedule.mutate({ id });
  };

  const handleRunNow = async () => {
    if (
      await showConfirm(runNowConfirmText(schedule), "Run now?", {
        confirmLabel: "Run now",
      })
    )
      runScheduleNow.mutate(
        { id },
        {
          onSuccess: () =>
            emitToast({
              kind: "success",
              message: runNowStartedText(schedule),
            }),
        },
      );
  };

  const handleReset = async () => {
    if (
      await showConfirm(
        `Reset the session for "${name}"? The next run starts a fresh conversation.`,
        "Reset session?",
        { confirmLabel: "Reset session" },
      )
    )
      resetScheduleSession.mutate({ id });
  };

  return (
    <RowActionsMenu label="Schedule actions">
      {onceState === null && (
        <DropdownMenuItem onSelect={handleRunNow}>Run now</DropdownMenuItem>
      )}
      {(onceState === null || onceState === "pending") && (
        <DropdownMenuItem onSelect={handleEdit}>Edit schedule</DropdownMenuItem>
      )}
      {sessionMode === "continuous" && (
        <DropdownMenuItem onSelect={handleReset}>
          Reset session
        </DropdownMenuItem>
      )}
      <DropdownMenuItem tone="danger" onSelect={handleDelete}>
        Delete schedule
      </DropdownMenuItem>
    </RowActionsMenu>
  );
}
