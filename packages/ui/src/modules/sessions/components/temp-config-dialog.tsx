import { useStore } from "../../../store.js";
import type { AgentState } from "../../../types.js";
import { FullscreenPreviewDialog } from "../../files/components/fullscreen-preview-dialog.js";
import { MetricsPanel } from "../../metrics/components/metrics-panel.js";
import { prefetchSchedules } from "../../schedules/api/queries.js";
import { ConfigurationPanel } from "./configuration-panel.js";

/** Temporary home for the torn-down right panel's Config/Metrics content
 *  (model settings, schedules, channels, skills, metrics) until the sandbox
 *  config page (#2124) rehomes it. Opened from the chat header. */
export function TempConfigDialog({
  agentId,
  agentState,
  sessionId,
  onResumeSession,
  onOpenFile,
  onClose,
}: {
  agentId: string | null;
  agentState: AgentState | undefined;
  sessionId: string | null;
  onResumeSession: (sessionId: string) => void;
  onOpenFile: (path: string) => void;
  onClose: () => void;
}) {
  const rightTab = useStore((s) => s.rightTab);
  const setRightTab = useStore((s) => s.setRightTab);
  const tabs = ["configuration", "metrics"] as const;

  return (
    <FullscreenPreviewDialog title="Sandbox configuration" onClose={onClose}>
      <div className="mx-auto max-w-[720px] flex flex-col h-full">
        <div className="flex border-b border-border-light shrink-0">
          {tabs.map((tab) => {
            const warmCache =
              tab === "configuration" && agentId
                ? () => prefetchSchedules(agentId)
                : undefined;
            return (
              <button
                key={tab}
                onClick={() => setRightTab(tab)}
                onMouseEnter={warmCache}
                onFocus={warmCache}
                className={`flex-1 h-11 text-[11px] font-bold uppercase tracking-[0.05em] border-b-2 transition-colors ${rightTab === tab ? "text-accent border-accent bg-accent-light" : "text-text-muted border-transparent hover:text-text-secondary"}`}
              >
                {tab === "configuration" ? "config" : tab}
              </button>
            );
          })}
        </div>
        <div className="flex flex-1 flex-col overflow-hidden">
          <div
            className={`flex flex-1 flex-col overflow-hidden ${rightTab === "configuration" ? "" : "hidden"}`}
          >
            <ConfigurationPanel
              onResumeSession={onResumeSession}
              agentId={agentId}
              agentState={agentState}
              onOpenFile={onOpenFile}
            />
          </div>
          {rightTab === "metrics" && (
            <MetricsPanel agentId={agentId} sessionId={sessionId} />
          )}
        </div>
      </div>
    </FullscreenPreviewDialog>
  );
}
