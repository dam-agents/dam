import type { Schedule } from "../../../types.js";
import { isUpcoming } from "./once-schedule.js";
import { precheckAlert } from "./schedule-format.js";

export interface OwnerScheduleRow {
  schedule: Schedule;
  agentName: string;
  active: boolean;
  problem: string | null;
}

function scheduleProblem(schedule: Schedule): string | null {
  const stopReason = schedule.enabled ? schedule.status?.stopReason : undefined;
  if (stopReason) return `Stopped: ${stopReason}`;
  return precheckAlert(schedule)?.text ?? null;
}

function byNextRun(a: OwnerScheduleRow, b: OwnerScheduleRow): number {
  const an = a.schedule.status?.nextRun;
  const bn = b.schedule.status?.nextRun;
  if (an && bn) return an.localeCompare(bn);
  if (an) return -1;
  if (bn) return 1;
  return a.schedule.name.localeCompare(b.schedule.name);
}

function byLastRunDesc(a: OwnerScheduleRow, b: OwnerScheduleRow): number {
  return (b.schedule.status?.lastRun ?? "").localeCompare(
    a.schedule.status?.lastRun ?? "",
  );
}

export function ownerScheduleRows(
  schedules: readonly Schedule[],
  agents: readonly { id: string; name: string }[],
): OwnerScheduleRow[] {
  const names = new Map(agents.map((a) => [a.id, a.name]));
  const rows = schedules.map((schedule) => ({
    schedule,
    agentName: names.get(schedule.agentId) ?? schedule.agentId,
    active: isUpcoming(schedule),
    problem: scheduleProblem(schedule),
  }));
  return [
    ...rows.filter((r) => r.active).sort(byNextRun),
    ...rows.filter((r) => !r.active).sort(byLastRunDesc),
  ];
}
