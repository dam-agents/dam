import { useMutation } from "@tanstack/react-query";

import { setAgentSessionTitle } from "./acp-session-ops.js";
import { acpSessionsKeys } from "./keys.js";

interface RenameSessionInput {
  sessionId: string;
  title: string | null;
}

export function useRenameSession(agentId: string) {
  return useMutation({
    mutationFn: ({ sessionId, title }: RenameSessionInput) =>
      setAgentSessionTitle(agentId, sessionId, title),
    meta: {
      invalidates: [acpSessionsKeys.agent(agentId)],
      errorToast: "Failed to rename session",
    },
  });
}
