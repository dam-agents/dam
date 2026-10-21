import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import { failedLoad } from "../../../../lib/failed-load.js";
import { useStore } from "../../../../store.js";
import type { AgentView, SessionView } from "../../../../types.js";
import {
  useAgentsList,
  useIsAgentAnswerableSoon,
  useIsAgentOperable,
} from "../../../agents/api/queries.js";
import { useApprovalsForOwner } from "../../../approvals/api/queries.js";
import { useActivityConversations } from "../../../home/hooks/use-activity-conversations.js";
import type { AgentActivitySession } from "../../../home/hooks/use-activity-sessions.js";
import { useActivitySessions } from "../../../home/hooks/use-activity-sessions.js";
import {
  filterActivitySessions,
  matchesActivityFilters,
} from "../../../home/lib/activity-sessions.js";
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
import { usePinnedSessions } from "../../../sessions/lib/pinned-sessions.js";
import { newestFirst } from "../../../sessions/lib/sidebar-session-window.js";
import { useSessionConversations } from "../../../sessions/lib/use-session-conversations.js";
import { useSessionSpend } from "../../../spend/api/queries.js";
import {
  awaitsApproval,
  offFeedPins,
  pinActivityQuery,
} from "../../lib/sidebar-tree.js";
import { RetryRow } from "./add-row.js";
import { TreeSessionRow } from "./tree-session-row.js";

export function FeedSessionRow({
  item,
  pinned,
  conversation,
  onNavigate,
}: {
  item: AgentActivitySession;
  pinned: boolean;
  conversation?: string;
  onNavigate?: () => void;
}) {
  const session = useMemo(
    () => provisionalSessionView(item.session),
    [item.session],
  );
  return (
    <AgentSessionRow
      agent={item.agent}
      session={session}
      pinned={pinned}
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
  const lookup = useAgentSession(agent.id, sessionId, { enabled: answerable });
  const { data: session, isFetching, refetch } = lookup;
  const conversationOf = useSessionConversations(agent.id);
  const approvals = useApprovalsForOwner().data;
  const filters = useStore((s) => s.sidebarActivityFilters);
  const open = useStore(
    (s) =>
      s.view === "chat" &&
      s.selectedAgent === agent.id &&
      s.sessionId === sessionId,
  );
  if (!session)
    return answerable && failedLoad(lookup) ? (
      <div data-pin-key={`${agent.id}:${sessionId}`}>
        <RetryRow
          label={`Couldn't load a pinned session of ${agent.name}.`}
          testId="sidebar-pin-failed"
          retrying={isFetching}
          onRetry={() => void refetch()}
        />
      </div>
    ) : null;
  const working = !!session.running;
  const unread = isUnreadSession(session, { open });
  const needsApproval = awaitsApproval(approvals ?? [], agent.id, sessionId);
  if (
    !matchesActivityFilters(
      { session, working, unread, needsApproval },
      filters,
    )
  )
    return null;
  return (
    <AgentSessionRow
      agent={agent}
      session={session}
      pinned
      working={working}
      unread={unread}
      conversation={conversationOf(session)}
      onNavigate={onNavigate}
    />
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The rows of the Pinned section: every pinned Session of every Agent, ordered by latest activity, read from the owner's attention record or, for a pin the record does not hold, from its own Agent. A pin whose Session is gone and whose Agent no longer exists resolves to no row at all, so a stored pin is not by itself something to show.
 */
export function usePinnedRows() {
  const activity = useActivitySessions();
  const pins = usePinnedSessions();
  const filters = useStore((s) => s.sidebarActivityFilters);
  const agents = useAgentsList();
  const pinned = useMemo(
    () =>
      filterActivitySessions(activity.items, filters).filter((item) =>
        pins.has(item.id),
      ),
    [activity.items, filters, pins],
  );
  const inFeed = useMemo(
    () => new Set(activity.items.map((item) => item.id)),
    [activity.items],
  );
  const offFeed = offFeedPins(
    pins,
    inFeed,
    agents.map((agent) => agent.id),
  ).flatMap(({ agentId, sessionId }) =>
    agents
      .filter((agent) => agent.id === agentId)
      .map((agent) => ({ agent, sessionId })),
  );
  const offFeedAt = useQueries({
    queries: offFeed.map(({ agent, sessionId }) =>
      pinActivityQuery(agent.id, sessionId),
    ),
  });
  const rows = newestFirst(
    [
      ...pinned.map((item) => ({ key: item.id, at: item.at, item })),
      ...offFeed.map((pin, i) => ({
        key: `${pin.agent.id}:${pin.sessionId}`,
        at: offFeedAt[i]?.data,
        pin,
      })),
    ],
    (row) => row.at,
    (row) => row.key,
  );
  const conversationOf = useActivityConversations(
    pinned.map((item) => item.session),
    agents,
  );
  return { rows, conversationOf };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Pinned section of JanUI's tree: the rows usePinnedRows resolves, each opening its Session. The tree shows it above the Agents and the collapsed rail shows it in a popover, so both draw the same rows.
 */
export function PinnedList({ onNavigate }: { onNavigate?: () => void }) {
  const { rows, conversationOf } = usePinnedRows();
  return (
    <>
      {rows.map((row) =>
        "item" in row ? (
          <FeedSessionRow
            key={row.key}
            item={row.item}
            pinned
            conversation={conversationOf(row.item.session)}
            onNavigate={onNavigate}
          />
        ) : (
          <OffFeedPinnedRow
            key={row.key}
            agent={row.pin.agent}
            sessionId={row.pin.sessionId}
            onNavigate={onNavigate}
          />
        ),
      )}
    </>
  );
}

function AgentSessionRow({
  agent,
  session,
  pinned,
  working,
  unread,
  conversation,
  onNavigate,
}: {
  agent: AgentView;
  session: SessionView;
  pinned: boolean;
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
      pinned={pinned}
      withAgent={agent}
      onNavigate={onNavigate}
    />
  );
}
