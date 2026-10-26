import { useEffect, useRef } from "react";

import { emitToast } from "../../../lib/toast.js";
import { useAgentsList } from "../api/queries.js";
import { type CrashMark, nextCrashNotices } from "../lib/crash-notices.js";

export function useAgentCrashToasts(): void {
  const agents = useAgentsList();
  const marksRef = useRef<ReadonlyMap<string, CrashMark>>(new Map());

  useEffect(() => {
    const { marks, toasts } = nextCrashNotices(marksRef.current, agents);
    marksRef.current = marks;
    for (const toast of toasts) emitToast(toast);
  }, [agents]);
}
