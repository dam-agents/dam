import { useMemo } from "react";

import { cn } from "@/lib/utils";

import { useStore } from "../../../../store.js";
import type { AgentView, SessionView } from "../../../../types.js";
import {
  useIsAgentAnswerableSoon,
  useIsAgentOperable,
} from "../../../agents/api/queries.js";
import { useApprovalsForOwner } from "../../../approvals/api/queries.js";
import type { AgentActivitySession } from "../../../home/hooks/use-activity-sessions.js";
import { matchesActivityFilters } from "../../../home/lib/activity-sessions.js";
import { isUnreadSession } from "../../../home/lib/unread.js";
import { useSessionBackgroundWork } from "../../../sessions/api/background-work.js";
import {
  provisionalSessionView,
  useAgentSession,
} from "../../../sessions/api/queries.js";
import {
  draftKey,
  keysWithDraftContent,
} from "../../../sessions/lib/draft-key.js";
import { useSessionConversations } from "../../../sessions/lib/use-session-conversations.js";
import { useSessionSpend } from "../../../spend/api/queries.js";
import { awaitsApproval } from "../../lib/sidebar-tree.js";
import { FOCUS_RING } from "./add-row.js";
import { TreeSessionRow } from "./tree-session-row.js";

export function FeedPinnedRow({
  item,
  conversation,
  onNavigate,
}: {
  item: AgentActivitySession;
  conversation?: string;
  onNavigate?: () => void;
}) {
  const session = useMemo(
    () => provisionalSessionView(item.session),
    [item.session],
  );
  return (
    <PinnedSessionRow
      agent={item.agent}
      session={session}
      working={item.working}
      unread={item.unread}
      conversation={conversation}
      onNavigate={onNavigate}
    />
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A pinned Session that the owner's bounded attention feed does not hold, read by its id from its Agent while the Agent can answer, so an old pin needs one lookup and not its Agent's whole history. The lookup refreshes on the Agent's attention hint. A failed first lookup offers a retry rather than hiding the pin; a pin whose Session is gone shows nothing and stays stored.
 */
export function OffFeedPinnedRow({
  agent,
  sessionId,
  onNavigate,
}: {
  agent: AgentView;
  sessionId: string;
  onNavigate?: () => void;
}) {
  const answerable = useIsAgentAnswerableSoon(agent.id);
  const {
    data: session,
    isError,
    isFetching,
    refetch,
  } = useAgentSession(agent.id, sessionId, { enabled: answerable });
  const conversationOf = useSessionConversations(agent.id);
  const filters = useStore((s) => s.sidebarActivityFilters);
  const open = useStore(
    (s) =>
      s.view === "chat" &&
      s.selectedAgent === agent.id &&
      s.sessionId === sessionId,
  );
  if (!session)
    return isError && !isFetching ? (
      <div data-pin-key={`${agent.id}:${sessionId}`}>
        <button
          type="button"
          data-testid="sidebar-pin-failed"
          onClick={() => void refetch()}
          className={cn(
            "flex h-[30px] w-full items-center rounded-lg px-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            FOCUS_RING,
          )}
        >
          Couldn't load a pinned session of {agent.name}. Retry
        </button>
      </div>
    ) : null;
  const working = !!session.running;
  const unread = isUnreadSession(session, { open });
  if (!matchesActivityFilters({ session, working, unread }, filters))
    return null;
  return (
    <PinnedSessionRow
      agent={agent}
      session={session}
      working={working}
      unread={unread}
      conversation={conversationOf(session)}
      onNavigate={onNavigate}
    />
  );
}

function PinnedSessionRow({
  agent,
  session,
  working,
  unread,
  conversation,
  onNavigate,
}: {
  agent: AgentView;
  session: SessionView;
  working: boolean;
  unread: boolean;
  conversation?: string;
  onNavigate?: () => void;
}) {
  const { agentId, sessionId } = session;
  const sessions = useMemo(() => [session], [session]);
  const active = useStore(
    (s) =>
      s.view === "chat" &&
      s.selectedAgent === agentId &&
      s.sessionId === sessionId,
  );
  const approvals = useApprovalsForOwner().data;
  const permissionPending = useStore((s) =>
    s.pendingPermissions.some((p) => p.sessionId === sessionId),
  );
  const backgroundWork = useSessionBackgroundWork(agentId, sessionId);
  const draft = useStore((s) =>
    keysWithDraftContent(s.drafts).includes(draftKey(agentId, sessionId)),
  );
  const cost = useSessionSpend(agentId, sessions).get(sessionId);
  const operable = useIsAgentOperable(agentId);
  return (
    <TreeSessionRow
      agentId={agentId}
      session={session}
      state={{
        active,
        working,
        needsApproval:
          permissionPending ||
          awaitsApproval(approvals ?? [], agentId, sessionId),
        unread,
        backgroundWork,
        draft,
        cost,
        conversation,
      }}
      operable={operable}
      pinned
      prefix={agent.name}
      onNavigate={onNavigate}
    />
  );
}
