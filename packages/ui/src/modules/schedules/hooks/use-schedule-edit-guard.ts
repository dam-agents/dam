import { useStore } from "../../../store.js";
import type { Schedule } from "../../../types.js";
import { scheduleLockNotice } from "../components/schedule-lock-notice.js";
import { scheduleLock } from "../lib/schedule-lock.js";

export type ScheduleEditGuard = (
  schedule: Schedule,
  agentName: string,
  onEdit: () => void,
) => Promise<void>;

export function useScheduleEditGuard(): ScheduleEditGuard {
  const showAlert = useStore((s) => s.showAlert);
  const showConfirm = useStore((s) => s.showConfirm);
  const selectAgent = useStore((s) => s.selectAgent);

  return async (schedule, agentName, onEdit) => {
    const lock = scheduleLock(schedule);
    if (!lock) {
      onEdit();
      return;
    }
    const { title, body, action } = scheduleLockNotice(lock, agentName);
    if (!action) {
      await showAlert(body, title, { kind: "info", confirmLabel: "Close" });
      return;
    }
    const confirmed = await showConfirm(body, title, {
      kind: "info",
      confirmLabel: action,
      cancelLabel: "Close",
    });
    if (confirmed) selectAgent(schedule.agentId);
  };
}
