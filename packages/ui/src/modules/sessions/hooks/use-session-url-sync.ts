import type { SessionMode } from "api-server-api";
import { useEffect } from "react";

import { useStore } from "../../../store.js";
import { nextChatUrl, sessionPath } from "../lib/session-path.js";

function writeSessionPath(path: string, mode: "push" | "replace"): void {
  const url = nextChatUrl(window.location, path);
  if (url === null) return;
  if (mode === "push") history.pushState(null, "", url);
  else history.replaceState(null, "", url);
}

export function pushSessionPath(
  agentId: string,
  sessionId: string | null,
  sessionMode: SessionMode | null,
): void {
  writeSessionPath(sessionPath(agentId, sessionId, sessionMode), "push");
}

export function useSessionUrlSync(agentId: string | null): void {
  const view = useStore((s) => s.view);
  const sessionId = useStore((s) => s.sessionId);
  const sessionMode = useStore((s) => s.sessionMode);
  const pendingResumeSessionId = useStore((s) => s.pendingResumeSessionId);

  useEffect(() => {
    if (view !== "chat" || !agentId) return;
    if (pendingResumeSessionId) return;
    writeSessionPath(sessionPath(agentId, sessionId, sessionMode), "replace");
  }, [view, agentId, sessionId, sessionMode, pendingResumeSessionId]);
}
