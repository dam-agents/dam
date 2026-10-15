import { useStore } from "../../../store.js";
import type { Schedule } from "../../../types.js";
import { scheduleLockNotice } from "../components/schedule-lock-notice.js";
import type { ExactCronConversion } from "../lib/cron-conversion.js";
import { scheduleLock } from "../lib/schedule-lock.js";

interface EditHandlers {
  onEdit: () => void;
  onConvert: (conversion: ExactCronConversion) => void;
}

type ScheduleEditGuard = (
  schedule: Schedule,
  agentName: string,
  handlers: EditHandlers,
) => Promise<void>;

export function useScheduleEditGuard(): ScheduleEditGuard {
  const showAlert = useStore((s) => s.showAlert);
  const showConfirm = useStore((s) => s.showConfirm);
  const selectAgent = useStore((s) => s.selectAgent);

  return async (schedule, agentName, { onEdit, onConvert }) => {
    const lock = scheduleLock(schedule);
    if (!lock) {
      onEdit();
      return;
    }
    const conversion =
      lock === "legacy-cron"
        ? (await import("../lib/cron-conversion.js")).convertCron(
            schedule.cron ?? "",
          )
        : undefined;
    const { title, body, action } = scheduleLockNotice(
      lock,
      agentName,
      conversion,
    );
    if (!action) {
      await showAlert(body, title, { kind: "info", confirmLabel: "Close" });
      return;
    }
    const confirmed = await showConfirm(body, title, {
      kind: "info",
      confirmLabel: action,
      cancelLabel: "Close",
    });
    if (!confirmed) return;
    if (lock === "agent-managed") selectAgent(schedule.agentId);
    else if (conversion?.kind === "exact") onConvert(conversion);
  };
}
