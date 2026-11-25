import { useMemo, useState } from "react";

import { FOCUS_RING } from "@/components/ui/focus-ring";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { SessionView } from "../../../types.js";
import { useAgentsList, useSharedAgents } from "../../agents/api/queries.js";
import { ActivityFilterMenu } from "../../home/components/activity-filter-menu.js";
import { useActivityConversations } from "../../home/hooks/use-activity-conversations.js";
import {
  type AgentActivitySession,
  useActivitySessions,
} from "../../home/hooks/use-activity-sessions.js";
import {
  defaultActivityFilters,
  isFiltered,
} from "../../home/lib/activity-filter.js";
import { filterActivitySessions } from "../../home/lib/activity-sessions.js";
import { provisionalSessionView } from "../api/queries.js";
import { useOpenSession } from "../hooks/use-open-session.js";
import { useSessionRowActions } from "../hooks/use-session-row-actions.js";
import {
  setAgentSessionFilter,
  useAgentSessionFilter,
} from "../lib/agent-session-filters.js";
import { SIDEBAR_SESSION_ROW_CLASS } from "../lib/sidebar-session-row.js";
import { RenameSessionDialog } from "./rename-session-dialog.js";
import { SessionRow } from "./session-row.js";
import { SidebarAgentSessions } from "./sidebar-agent-sessions.js";

const PAGE = 20;

interface Props {
  stickyHeaderClassName?: string;
  onNavigate?: () => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the sidebar's one list of Sessions. In All
 * agents it lists the attention record's rows for every Agent the person
 * owns, newest activity first, each with its Agent, and its filter is the
 * one kept for this list. In an agent view it lists that Agent's own list
 * instead, and its filter is the one kept for that Agent. Opening a Session
 * never changes the view.
 */
export function SidebarSessions({ stickyHeaderClassName, onNavigate }: Props) {
  const sidebarAgent = useStore((s) => s.sidebarAgent);
  return (
    <section aria-label="Sessions" data-testid="sidebar-sessions">
      <div
        className={cn(
          "mb-1.5 flex items-center justify-between pt-3 pr-1 pb-1 pl-3",
          stickyHeaderClassName && [
            "sticky top-0 z-raised",
            stickyHeaderClassName,
          ],
        )}
      >
        <SectionLabel>Sessions</SectionLabel>
        {sidebarAgent === null ? (
          <AllAgentsFilter />
        ) : (
          <AgentFilter agentId={sidebarAgent} />
        )}
      </div>
      {sidebarAgent === null ? (
        <AllAgentsSessions onNavigate={onNavigate} />
      ) : (
        <SidebarAgentSessions agentId={sidebarAgent} onNavigate={onNavigate} />
      )}
    </section>
  );
}

const FILTER_CLASS = `border border-border bg-background ${FOCUS_RING}`;

function AllAgentsFilter() {
  const filters = useStore((s) => s.sidebarActivityFilters);
  const setFilters = useStore((s) => s.setSidebarActivityFilters);
  return (
    <ActivityFilterMenu
      className={FILTER_CLASS}
      filters={filters}
      onChange={setFilters}
    />
  );
}

function AgentFilter({ agentId }: { agentId: string }) {
  const filter = useAgentSessionFilter(agentId);
  return (
    <ActivityFilterMenu
      className={FILTER_CLASS}
      filters={filter ?? defaultActivityFilters()}
      onChange={(next) => setAgentSessionFilter(agentId, next)}
      testId="sidebar-agent-session-filter"
    />
  );
}

function AllAgentsSessions({ onNavigate }: { onNavigate?: () => void }) {
  const { items, openSessionKey, loading, unreadable } = useActivitySessions();
  const filters = useStore((s) => s.sidebarActivityFilters);
  const openSession = useOpenSession();
  const [shown, setShown] = useState(PAGE);
  const [shownFilters, setShownFilters] = useState(filters);
  if (shownFilters !== filters) {
    setShownFilters(filters);
    setShown(PAGE);
  }
  const [renaming, setRenaming] = useState<{
    agentId: string;
    session: SessionView;
  } | null>(null);
  const agents = useAgentsList();
  const hasShared = useSharedAgents().length > 0;
  const sessions = useMemo(() => items.map((item) => item.session), [items]);
  const conversationOf = useActivityConversations(sessions, agents);

  const matching = filterActivitySessions(items, filters);
  const visible = matching.slice(0, shown);

  return (
    <>
      {!loading && visible.length === 0 && (
        <p className="px-2.5 py-1.5 text-xs text-muted-foreground">
          {unreadable
            ? "Sessions can't be loaded right now."
            : isFiltered(filters)
              ? "No sessions match the filter."
              : hasShared
                ? "Sessions on agents shared with you show when you open the agent."
                : "No conversations yet"}
        </p>
      )}
      <div className="flex flex-col gap-1">
        {visible.map((item) => (
          <AllAgentsSessionRow
            key={item.id}
            item={item}
            active={item.id === openSessionKey}
            conversation={conversationOf(item.session)}
            onRename={(session) =>
              setRenaming({ agentId: item.session.agentId, session })
            }
            onOpen={() => {
              openSession(
                item.session.agentId,
                item.session.sessionId,
                item.session.mode,
              );
              onNavigate?.();
            }}
          />
        ))}
      </div>
      {matching.length > shown && (
        <button
          type="button"
          onClick={() => setShown(shown + PAGE)}
          className="mt-px flex h-[30px] w-full items-center rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          View more
        </button>
      )}
      {renaming && (
        <RenameSessionDialog
          agentId={renaming.agentId}
          session={renaming.session}
          onClose={() => setRenaming(null)}
        />
      )}
    </>
  );
}

function AllAgentsSessionRow({
  item,
  active,
  conversation,
  onRename,
  onOpen,
}: {
  item: AgentActivitySession;
  active: boolean;
  conversation: string | undefined;
  onRename: (session: SessionView) => void;
  onOpen: () => void;
}) {
  const actions = useSessionRowActions(item.session.agentId, onRename);
  const session = provisionalSessionView(item.session);
  return (
    <SessionRow
      session={session}
      agent={item.agent}
      active={active}
      working={item.working}
      needsApproval={item.needsApproval}
      unread={item.unread}
      conversation={conversation}
      className={SIDEBAR_SESSION_ROW_CLASS}
      onResume={onOpen}
      onRename={() => actions.rename(session)}
      onDelete={() => void actions.delete(session)}
      {...(actions.exportTimeline && {
        onExportTimeline: () => actions.exportTimeline?.(session),
      })}
    />
  );
}
