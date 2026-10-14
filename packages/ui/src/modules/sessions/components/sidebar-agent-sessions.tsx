import { SessionMode, TELEMETRY_MAX_SINCE_HOURS } from "api-server-api";
import { useState } from "react";

import { Spinner } from "@/components/ui/spinner";

import { useStore } from "../../../store.js";
import type { SessionView } from "../../../types.js";
import { useFeatures } from "../../features/api/queries.js";
import { downloadTelemetryExport } from "../../telemetry/api/download-export.js";
import { prefetchSessionHistory } from "../api/queries.js";
import { useAgentSessionList } from "../hooks/use-agent-session-list.js";
import { useOpenSession } from "../hooks/use-open-session.js";
import { RenameSessionDialog } from "./rename-session-dialog.js";
import { SessionListSkeleton } from "./session-list-skeleton.js";
import { SessionRow } from "./session-row.js";

const FIRST_PAGE = 5;
const MORE_PAGE = 10;

export function SidebarAgentSessions({ agentId }: { agentId: string }) {
  const list = useAgentSessionList(agentId);
  const openSession = useOpenSession();
  const deleteSession = useStore((s) => s.deleteSession);
  const showConfirm = useStore((s) => s.showConfirm);
  const telemetryEnabled = useFeatures().data?.["agent-telemetry"] ?? false;
  const [shown, setShown] = useState(FIRST_PAGE);
  const [renaming, setRenaming] = useState<SessionView | null>(null);

  const visible = list.sessions.slice(0, shown);
  const hasMore = list.sessions.length > shown || list.hasNextPage;

  const showMore = () => {
    const next = shown + MORE_PAGE;
    setShown(next);
    if (next > list.sessions.length && list.hasNextPage)
      void list.fetchNextPage();
  };

  const confirmDelete = async (s: SessionView) => {
    const label = s.title || s.sessionId.slice(0, 12);
    if (
      await showConfirm(
        "Its transcript is deleted and cannot be recovered.",
        `Delete session “${label}”?`,
        { kind: "destructive", confirmLabel: "Delete session" },
      )
    ) {
      void deleteSession(s.sessionId);
    }
  };

  return (
    <div
      className="flex flex-col gap-px pb-1"
      data-testid="sidebar-agent-sessions"
      data-provisional={list.provisional ? "true" : undefined}
      aria-busy={list.provisional || list.loading}
    >
      {list.loading && <SessionListSkeleton />}
      {!list.loading && list.sessions.length === 0 && (
        <p className="py-1.5 pl-9 text-xs text-muted-foreground">
          {list.filtered ? "No sessions match the filter." : "No sessions yet."}
        </p>
      )}
      {visible.map((s) => (
        <SessionRow
          key={s.sessionId}
          session={s}
          {...list.rowState(s)}
          className="rounded-lg border-b-0 py-1.5 pr-2 pl-9"
          onResume={() => openSession(agentId, s.sessionId, s.mode)}
          {...(list.operable &&
            s.mode !== SessionMode.Terminal && {
              onPrefetch: () => prefetchSessionHistory(agentId, s.sessionId),
            })}
          onRename={() => setRenaming(s)}
          onDelete={() => void confirmDelete(s)}
          {...(telemetryEnabled && {
            onExportTimeline: () =>
              void downloadTelemetryExport({
                agentId,
                sessionId: s.sessionId,
                signal: "logs",
                sinceHours: TELEMETRY_MAX_SINCE_HOURS,
              }),
          })}
        />
      ))}
      {hasMore && (
        <button
          type="button"
          onClick={showMore}
          disabled={list.isFetchingNextPage}
          className="flex h-[30px] items-center gap-2 rounded-lg pl-9 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {list.isFetchingNextPage && <Spinner />}
          View more
        </button>
      )}
      {renaming && (
        <RenameSessionDialog
          agentId={agentId}
          session={renaming}
          onClose={() => setRenaming(null)}
        />
      )}
    </div>
  );
}
