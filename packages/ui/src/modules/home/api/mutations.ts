import { useMutation } from "@tanstack/react-query";

import { emitToast } from "../../../lib/toast.js";
import { markAgentSessionSeen } from "../../sessions/api/acp-session-ops.js";
import { setSessionSeen } from "../../sessions/api/queries.js";

export interface SeenTarget {
  agentId: string;
  sessionId: string;
}

export function useMarkSessionsSeen() {
  return useMutation({
    mutationFn: async (targets: readonly SeenTarget[]) => {
      const results = await Promise.allSettled(
        targets.map((target) =>
          markAgentSessionSeen(target.agentId, target.sessionId),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      return { total: targets.length, failed };
    },
    onMutate: (targets) => {
      for (const target of targets) {
        setSessionSeen(target.agentId, target.sessionId);
      }
    },
    onSuccess: ({ total, failed }) => {
      if (failed === 0) return;
      emitToast({
        kind: "error",
        message:
          total === 1
            ? "Couldn't dismiss that item — it will come back."
            : `Dismissed ${total - failed} of ${total} — the rest will come back.`,
      });
    },
    onError: () => {
      emitToast({
        kind: "error",
        message: "Couldn't dismiss — the items will come back.",
      });
    },
  });
}
