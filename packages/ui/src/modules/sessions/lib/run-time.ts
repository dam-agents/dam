import type { SessionView } from "api-server-api";

import { formatDuration } from "@/lib/format-time";

export function runTimeLabel(s: SessionView): string | null {
  const runs = s.runCount ?? 0;
  const total = formatDuration(s.runTotalMs ?? 0);
  const counted = `${runs} ${runs === 1 ? "run" : "runs"}`;
  if (s.runStartedAt)
    return runs ? `Running now · ${counted} finished, ${total}` : "Running now";
  if (!runs) return null;
  return runs === 1 ? `Ran ${total}` : `Ran ${total} across ${counted}`;
}
