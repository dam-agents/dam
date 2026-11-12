import { useEffect, useRef } from "react";

import { emitToast } from "../../../lib/toast.js";
import { useAgentsList } from "../api/queries.js";
import { type CrashMark, nextCrashNotices } from "../lib/crash-notices.js";

export function useAgentCrashToasts(): void {
  const agents = useAgentsList();
  const marksRef = useRef<ReadonlyMap<string, CrashMark>>(new Map());

  useEffect(() => {
    const crashes = nextCrashNotices(marksRef.current, agents);
    marksRef.current = crashes.marks;
    for (const toast of crashes.toasts) emitToast(toast);
  }, [agents]);
}
