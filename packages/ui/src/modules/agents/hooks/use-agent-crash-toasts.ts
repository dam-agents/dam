import { useEffect, useRef } from "react";

import { emitToast } from "../../../lib/toast.js";
import { useAgentsList } from "../api/queries.js";
import { type CrashMark, nextCrashNotices } from "../lib/crash-notices.js";
import { nextReclaimNotices } from "../lib/reclaim-notices.js";

export function useAgentCrashToasts(): void {
  const agents = useAgentsList();
  const marksRef = useRef<ReadonlyMap<string, CrashMark>>(new Map());
  const reclaimMarksRef = useRef<ReadonlyMap<string, string | null>>(new Map());

  useEffect(() => {
    const crashes = nextCrashNotices(marksRef.current, agents);
    marksRef.current = crashes.marks;
    const reclaims = nextReclaimNotices(reclaimMarksRef.current, agents);
    reclaimMarksRef.current = reclaims.marks;
    for (const toast of [...crashes.toasts, ...reclaims.toasts])
      emitToast(toast);
  }, [agents]);
}
