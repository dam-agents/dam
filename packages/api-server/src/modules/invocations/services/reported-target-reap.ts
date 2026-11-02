import type { TargetCapture } from "./target-capture.js";
import type { TargetReaper } from "./target-reaper.js";

const REPORT_SETTLE_MS = 10_000;
const OPEN_CALLS_RECHECK_MS = 5_000;
const FALLBACK_REAP_MS = 30_000;
const REPORT_REAP_LIMIT_MS = 90_000;

export type OpenCalls = (agentId: string) => Promise<number>;

interface ReportedTarget {
  id: string;
  owner: string;
}

export interface ReportedTargetReap {
  afterReport(row: ReportedTarget): void;
  due(row: ReportedTarget & { completedAt: Date | null }): Promise<boolean>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: reaps a target that reported its result only
 * once every model call it started has ended. The harness answers the
 * accepted report_result with one more model call, and a delete that cuts
 * that call leaves the meter no usage, so the call counts as an estimate.
 * The gateway meter notes each call when it starts and every record it sends
 * while it runs, so the target is reaped when the meter shows no open call on
 * two checks in a row, or after a hard limit for a call that never ends. When
 * the meter cannot be read, the target is reaped as before the wait existed,
 * a fixed time after its report. The conversation is copied
 * to the root driver when the target reports, so the chat shows it at once,
 * and again by the reap. The in-process wait is lost when the api-server
 * restarts, so the liveness sweep asks `due`, which keeps no state between
 * ticks: past the fixed time, one read with no open call is enough, and the
 * in-process wait has reaped every target it still holds by then.
 */
export function createReportedTargetReap(deps: {
  reaper: TargetReaper;
  capture: TargetCapture;
  openCalls: OpenCalls;
  settleMs?: number;
  recheckMs?: number;
  fallbackMs?: number;
  limitMs?: number;
  now?: () => Date;
}): ReportedTargetReap {
  const settleMs = deps.settleMs ?? REPORT_SETTLE_MS;
  const recheckMs = deps.recheckMs ?? OPEN_CALLS_RECHECK_MS;
  const fallbackMs = deps.fallbackMs ?? FALLBACK_REAP_MS;
  const limitMs = deps.limitMs ?? REPORT_REAP_LIMIT_MS;
  const now = deps.now ?? (() => new Date());

  async function openCalls(id: string): Promise<number | null> {
    try {
      return await deps.openCalls(id);
    } catch (err) {
      process.stderr.write(
        `[invocations] open calls of ${id} unreadable: ${err instanceof Error ? err.message : err}\n`,
      );
      return null;
    }
  }

  function later(run: () => Promise<void>, delayMs: number): void {
    const timer = setTimeout(() => void run(), delayMs);
    timer.unref();
  }

  return {
    afterReport(row) {
      const captured = deps.capture.capture(row);
      const reportedAt = now().getTime();
      let idleSeen = false;
      const reap = async () => {
        await captured;
        await deps.reaper.reap(row);
      };
      const check = async () => {
        const open = await openCalls(row.id);
        const age = now().getTime() - reportedAt;
        if (open === 0 && idleSeen) return reap();
        if (open === null && age >= fallbackMs) return reap();
        if (age >= limitMs) {
          process.stderr.write(
            `[invocations] reap ${row.id} at the ${limitMs}ms limit with ${open ?? "unknown"} open model calls\n`,
          );
          return reap();
        }
        idleSeen = open === 0;
        later(check, recheckMs);
      };
      later(check, settleMs);
    },

    async due(row) {
      const age =
        row.completedAt === null
          ? limitMs
          : now().getTime() - row.completedAt.getTime();
      if (age >= limitMs) return true;
      if (age < fallbackMs) return false;
      return ((await openCalls(row.id)) ?? 0) === 0;
    },
  };
}
