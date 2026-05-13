import type { SessionMode } from "api-server-api";
import { ArrowLeft, Plus, RefreshCw } from "lucide-react";
import { useCallback } from "react";

import { useStore } from "../../../store.js";
import { InstanceApprovalsTray } from "../../approvals/components/instance-approvals-tray.js";
import { useInstancesList } from "../../instances/api/queries.js";
import { useAcpSessions } from "../api/queries.js";
import { SessionRow } from "./session-row.js";

export function SessionsSidebar({
  onResumeSession,
  onNewSession,
}: {
  onResumeSession: (sid: string, mode?: SessionMode) => void;
  onNewSession: () => void;
}) {
  const selectedInstance = useStore((s) => s.selectedInstance);
  const sessionId = useStore((s) => s.sessionId);
  const pendingPermissions = useStore((s) => s.pendingPermissions);
  const includeChannel = useStore((s) => s.includeChannelSessions);
  const setIncludeChannel = useStore((s) => s.setIncludeChannelSessions);
  const deleteSession = useStore((s) => s.deleteSession);
  const showConfirm = useStore((s) => s.showConfirm);
  const goBack = useStore((s) => s.goBack);

  const instances = useInstancesList();
  const instanceRunState = instances.find((i) => i.id === selectedInstance)?.state;
  const { data: sessions = [], isFetching, refetch } = useAcpSessions(
    selectedInstance,
    includeChannel,
    { enabled: instanceRunState === "running" },
  );
  const loading = isFetching;

  const confirmDelete = useCallback(
    async (sid: string, title: string | null | undefined) => {
      const label = title || sid.slice(0, 12);
      if (await showConfirm(`Delete session "${label}"?`, "Delete Session")) {
        deleteSession(sid);
      }
    },
    [showConfirm, deleteSession],
  );

  return (
    <>
      <div className="flex items-center justify-between px-4 h-11 border-b border-border-light shrink-0 relative">
        {/* Mobile: back to agents */}
        <button
          className="md:hidden h-6 w-6 rounded-md flex items-center justify-center text-text-muted hover:text-accent transition-colors mr-2"
          onClick={goBack}
        >
          <ArrowLeft size={14} />
        </button>
        <span className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em]">
          Sessions
        </span>
        <button
          className={`ml-auto h-6 w-6 rounded-md border border-border-light flex items-center justify-center text-text-muted hover:text-accent hover:border-accent transition-colors`}
          onClick={() => refetch()}
        >
          <span className={loading ? "anim-spin" : ""}>
            <RefreshCw size={11} />
          </span>
        </button>
        {loading && (
          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent/20 overflow-hidden">
            <div className="h-full w-1/3 bg-accent rounded-full anim-slide" />
          </div>
        )}
      </div>
      <div className="px-4 py-2 border-b border-border-light">
        <label className="flex items-center gap-2 cursor-pointer text-[11px] text-text-muted">
          <input
            type="checkbox"
            checked={includeChannel}
            onChange={(e) => setIncludeChannel(e.target.checked)}
            className="accent-accent w-3 h-3"
          />
          Show channel sessions
        </label>
      </div>
      <div className="flex-1 overflow-y-auto">
        {!loading && sessions.length === 0 && (
          <p className="px-4 py-5 text-[12px] text-text-muted">
            No sessions yet
          </p>
        )}
        {sessions.map((s) => (
          <SessionRow
            key={s.sessionId}
            session={s}
            active={s.sessionId === sessionId}
            hasPending={pendingPermissions.some((p) => p.sessionId === s.sessionId)}
            onResume={() => onResumeSession(s.sessionId, s.mode)}
            onDelete={() => confirmDelete(s.sessionId, s.title)}
          />
        ))}
      </div>
      <InstanceApprovalsTray instanceId={selectedInstance} />
      <div className="px-3 py-3 border-t border-border-light shrink-0">
        <button
          className="w-full h-9 rounded-md border border-border-light text-[12px] font-semibold text-text-secondary hover:text-accent hover:border-accent flex items-center justify-center gap-1.5 transition-colors"
          onClick={onNewSession}
        >
          <Plus size={13} /> New Session
        </button>
      </div>
    </>
  );
}

