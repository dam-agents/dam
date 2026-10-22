import { sessionCategoryOf, SessionMode } from "api-server-api";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { failedLoad } from "../../../lib/failed-load.js";
import { useStore } from "../../../store.js";
import type { SessionView } from "../../../types.js";
import {
  useAgentRunState,
  useIsAgentAnswerableSoon,
  useIsAgentOperable,
} from "../../agents/api/queries.js";
import { useWakeAgent } from "../../agents/hooks/use-wake-agent.js";
import { useApprovalsForAgent } from "../../approvals/api/queries.js";
import { isUnreadSession } from "../../home/lib/unread.js";
import { useSessionSpend } from "../../spend/api/queries.js";
import { useAgentBackgroundWork } from "../api/background-work.js";
import { useProvisionalSessions, useSessionPages } from "../api/queries.js";
import { draftKey, keysWithDraftContent } from "../lib/draft-key.js";
import { shownSessionId } from "../lib/shown-session.js";
import { useSessionConversations } from "../lib/use-session-conversations.js";

const EMPTY: never[] = [];

export function useAgentSessionList(agentId: string) {
  const sessionId = useStore(shownSessionId);
  const busy = useStore((s) => s.busy);
  const pendingPermissions = useStore((s) => s.pendingPermissions);
  const sessionFilter = useStore((s) => s.sessionFilter);

  const operable = useIsAgentOperable(agentId);
  const answerableSoon = useIsAgentAnswerableSoon(agentId);
  const conversationOf = useSessionConversations(agentId);
  const {
    sessions: listed,
    isFetching,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    data,
    errorUpdatedAt,
    fetchNextPage,
    refetch,
  } = useSessionPages(agentId, sessionFilter, {
    enabled: answerableSoon,
    activeSessionId: sessionId,
  });
  const lastKnown = useProvisionalSessions(agentId, listed === undefined);
  const provisional = listed === undefined && !!lastKnown?.length;
  const sessions: SessionView[] =
    listed ?? (provisional ? lastKnown : undefined) ?? EMPTY;
  const loading =
    listed === undefined && !provisional && (isFetching || !operable);
  const runState = useAgentRunState(agentId);
  const restarting = useStore((s) => s.restartingAgents.has(agentId));
  const { wake } = useWakeAgent();
  const notWaking =
    loading &&
    lastKnown !== undefined &&
    runState === "hibernated" &&
    !restarting;

  const visible = useMemo(
    () => sessions.filter((s) => sessionFilter.includes(sessionCategoryOf(s))),
    [sessions, sessionFilter],
  );

  const costs = useSessionSpend(agentId, sessions);
  const { data: approvals = EMPTY } = useApprovalsForAgent(agentId);
  const approvalSessions = useMemo(() => {
    const set = new Set<string>();
    for (const a of approvals)
      if (a.status === "pending" && a.sessionId) set.add(a.sessionId);
    return set;
  }, [approvals]);

  const backgroundWork = useAgentBackgroundWork(agentId);
  const backgroundWorkBySession = useMemo(
    () => new Map(backgroundWork.map((s) => [s.sessionId, s.items])),
    [backgroundWork],
  );

  const draftKeys = useStore(useShallow((s) => keysWithDraftContent(s.drafts)));
  const draftKeySet = useMemo(() => new Set(draftKeys), [draftKeys]);

  const rowState = (s: SessionView) => {
    const open = s.sessionId === sessionId;
    const terminal = s.mode === SessionMode.Terminal;
    return {
      active: open,
      working: terminal ? !!s.running : (open && busy) || !!s.running,
      needsApproval:
        approvalSessions.has(s.sessionId) ||
        pendingPermissions.some((p) => p.sessionId === s.sessionId),
      unread: isUnreadSession(s, { open }),
      draft: !terminal && draftKeySet.has(draftKey(agentId, s.sessionId)),
      backgroundWork: backgroundWorkBySession.get(s.sessionId),
      cost: costs.get(s.sessionId),
      conversation: conversationOf(s),
    };
  };

  return {
    sessions: visible,
    rowState,
    operable,
    answerable: answerableSoon,
    loading,
    provisional,
    failed:
      notWaking ||
      (answerableSoon && !provisional && failedLoad({ data, errorUpdatedAt })),
    retrying: isFetching,
    retry: notWaking ? () => wake(agentId) : refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPageFailed: isFetchNextPageError,
    fetchNextPage,
  };
}
