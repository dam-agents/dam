import { useMemo, useState } from "react";

import { FOCUS_RING } from "@/components/ui/focus-ring";
import { SectionLabel } from "@/components/ui/section-label";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { useSidebarAgents } from "../../agents/hooks/use-sidebar-agents.js";
import { useOpenSession } from "../../sessions/hooks/use-open-session.js";
import { useActivityConversations } from "../hooks/use-activity-conversations.js";
import { useActivitySessions } from "../hooks/use-activity-sessions.js";
import { isFiltered } from "../lib/activity-filter.js";
import { filterActivitySessions } from "../lib/activity-sessions.js";
import { ActivityFilterMenu } from "./activity-filter-menu.js";
import { SidebarActivityRow } from "./sidebar-activity-row.js";

const PAGE = 20;
const MINUTE_MS = 60_000;

interface Props {
  stickyHeaderClassName?: string;
  onNavigate?: () => void;
}

export function SidebarActivity({ stickyHeaderClassName, onNavigate }: Props) {
  const { items, openSessionKey, loading, unreadable } = useActivitySessions();
  const filters = useStore((s) => s.sidebarActivityFilters);
  const setFilters = useStore((s) => s.setSidebarActivityFilters);
  const openSession = useOpenSession();
  const { isOpen } = useSidebarAgents();
  const setAgentOpen = useStore((s) => s.setSidebarAgentOpen);
  const [shown, setShown] = useState(PAGE);
  const now = useNow(MINUTE_MS);
  const agents = useAgentsList();
  const sessions = useMemo(() => items.map((item) => item.session), [items]);
  const conversationOf = useActivityConversations(sessions, agents);

  const matching = filterActivitySessions(items, filters);
  const visible = matching.slice(0, shown);

  return (
    <section aria-label="Activity" data-testid="sidebar-activity">
      <div
        className={cn(
          "mb-1.5 flex items-center justify-between pt-3 pr-1 pb-1 pl-3",
          stickyHeaderClassName && [
            "sticky top-0 z-raised",
            stickyHeaderClassName,
          ],
        )}
      >
        <SectionLabel>Activity</SectionLabel>
        <ActivityFilterMenu
          className={`border border-border bg-background ${FOCUS_RING}`}
          filters={filters}
          onChange={(next) => {
            setFilters(next);
            setShown(PAGE);
          }}
        />
      </div>
      {!loading && visible.length === 0 && (
        <p className="px-2.5 py-1.5 text-xs text-muted-foreground">
          {unreadable
            ? "Activity can't be loaded right now."
            : isFiltered(filters)
              ? "No sessions match the filter."
              : "No sessions yet."}
        </p>
      )}
      <ul className="flex flex-col gap-1">
        {visible.map((item) => (
          <SidebarActivityRow
            key={item.id}
            item={item}
            selected={item.id === openSessionKey}
            now={now}
            conversation={conversationOf(item.session)}
            onOpen={() => {
              setAgentOpen(item.session.agentId, isOpen(item.session.agentId));
              openSession(
                item.session.agentId,
                item.session.sessionId,
                item.session.mode,
              );
              onNavigate?.();
            }}
          />
        ))}
      </ul>
      {matching.length > shown && (
        <button
          type="button"
          onClick={() => setShown(shown + PAGE)}
          className="mt-px flex h-[30px] w-full items-center rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          View more
        </button>
      )}
    </section>
  );
}
