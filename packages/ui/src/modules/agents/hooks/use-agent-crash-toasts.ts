import { useEffect, useRef } from "react";

import { emitToast } from "../../../lib/toast.js";
import { useAskAssistant } from "../../assistants/hooks/use-ask-assistant.js";
import { askAboutCrash } from "../../assistants/lib/ask-prefill.js";
import { useAgentsList } from "../api/queries.js";
import { type CrashMark, nextCrashNotices } from "../lib/crash-notices.js";

export function useAgentCrashToasts(): void {
  const agents = useAgentsList();
  const { offered, label, ask } = useAskAssistant();
  const marksRef = useRef<ReadonlyMap<string, CrashMark>>(new Map());

  useEffect(() => {
    const crashes = nextCrashNotices(marksRef.current, agents);
    marksRef.current = crashes.marks;
    for (const toast of crashes.toasts) {
      const agent = agents.find((a) => a.id === toast.agentId) ?? null;
      if (agent === null || !offered(agent)) {
        emitToast(toast);
        continue;
      }
      emitToast({
        ...toast,
        ttl: 0,
        action: {
          label,
          onClick: () =>
            ask(
              askAboutCrash({
                agentName: agent.name,
                at: new Date().toISOString(),
                notice: toast.message,
              }),
            ),
        },
      });
    }
  }, [agents, offered, label, ask]);
}
