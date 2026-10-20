import { SessionMode, TELEMETRY_MAX_SINCE_HOURS } from "api-server-api";
import { type ComponentProps, useState } from "react";

import { useStore } from "../../../../store.js";
import type { SessionView } from "../../../../types.js";
import { useActWhenAwake } from "../../../agents/hooks/use-act-when-awake.js";
import {
  useFeatures,
  useInstallCapabilities,
} from "../../../features/api/queries.js";
import { prefetchSessionHistory } from "../../../sessions/api/queries.js";
import { backgroundWorkLabel } from "../../../sessions/components/background-work-indicator.js";
import { RenameSessionDialog } from "../../../sessions/components/rename-session-dialog.js";
import {
  SessionRow,
  sessionTitleLabel,
} from "../../../sessions/components/session-row.js";
import { useOpenSession } from "../../../sessions/hooks/use-open-session.js";
import {
  pinKey,
  togglePinnedSession,
  unpinSession,
} from "../../../sessions/lib/pinned-sessions.js";
import { downloadTelemetryExport } from "../../../telemetry/api/download-export.js";
import { activityTone, sessionContext } from "../../lib/sidebar-tree.js";
import { ActivityDot } from "./activity-dot.js";

type RowState = Omit<
  ComponentProps<typeof SessionRow>,
  | "session"
  | "onResume"
  | "onRename"
  | "onDelete"
  | "className"
  | "leading"
  | "indicators"
>;

export const TREE_ROW_CLASS = "min-w-0 rounded-lg border-b-0 px-2 py-2";

export function useDeleteTreeSession(agentId: string) {
  const deleteSession = useStore((st) => st.deleteSession);
  const showConfirm = useStore((st) => st.showConfirm);
  const actWhenAwake = useActWhenAwake(agentId);
  return async (s: SessionView) => {
    const label = s.title ? `“${s.title}”` : sessionTitleLabel(s);
    if (
      await showConfirm(
        "Its transcript is deleted and cannot be recovered.",
        `Delete session ${label}?`,
        { kind: "destructive", confirmLabel: "Delete session" },
      )
    )
      actWhenAwake(`delete:${s.sessionId}`, async () => {
        if (!(await deleteSession(s.sessionId, agentId))) return;
        unpinSession(pinKey(agentId, s.sessionId));
      });
  };
}

export function togglePinKeepingFocus(key: string, agentId: string): void {
  const focused = document.activeElement;
  const hadFocus =
    focused?.closest("[data-pin-key]")?.getAttribute("data-pin-key") === key;
  togglePinnedSession(key);
  if (!hadFocus) return;
  requestAnimationFrame(() => {
    const tree = document.querySelector('[data-testid="sidebar-tree"]');
    (
      tree?.querySelector<HTMLElement>(
        `[data-pin-key="${CSS.escape(key)}"] [data-testid="session-pin-button"]`,
      ) ??
      tree?.querySelector<HTMLElement>(
        `[data-agent-id="${CSS.escape(agentId)}"] [data-testid="sidebar-agent-row"]`,
      )
    )?.focus();
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: One Session row of the new layout's sidebar tree,
 * read from its Agent's own list: the activity dot, the context line, and the
 * row's actions. A pin keeps keyboard focus on the moved row, or on its Agent
 * row when the row's new place is closed. Rename and Delete wake the Agent and
 * run once it answers.
 */
export function TreeSessionRow({
  agentId,
  session: s,
  state,
  operable,
  pinned,
  prefix,
  onNavigate,
}: {
  agentId: string;
  session: SessionView;
  state: RowState;
  operable: boolean;
  pinned: boolean;
  prefix?: string;
  onNavigate?: () => void;
}) {
  const actWhenAwake = useActWhenAwake(agentId);
  const remove = useDeleteTreeSession(agentId);
  const openSession = useOpenSession();
  const [renaming, setRenaming] = useState(false);
  const telemetryFlag = useFeatures().data?.["agent-telemetry"] ?? false;
  const telemetryBackend =
    useInstallCapabilities().data?.telemetryBackend ?? false;
  const telemetry = telemetryFlag && telemetryBackend;
  const key = pinKey(agentId, s.sessionId);
  const tone = activityTone({
    working: state.working,
    needsApproval: state.needsApproval,
    unread: state.unread ?? false,
    backgroundWork: state.backgroundWork,
    draft: state.draft,
  });
  const context = sessionContext(s, state.conversation);

  return (
    <div className="relative" data-pin-key={key}>
      <SessionRow
        session={s}
        {...state}
        conversation={prefix ? `${prefix} · ${context}` : context}
        leading={
          <ActivityDot
            tone={tone}
            {...(tone === "background" &&
              state.backgroundWork && {
                label: backgroundWorkLabel(state.backgroundWork),
              })}
          />
        }
        indicators={false}
        className={TREE_ROW_CLASS}
        pinned={pinned}
        onTogglePin={() => togglePinKeepingFocus(key, agentId)}
        onResume={() => {
          openSession(agentId, s.sessionId, s.mode);
          onNavigate?.();
        }}
        {...(operable &&
          s.mode !== SessionMode.Terminal && {
            onPrefetch: () => prefetchSessionHistory(agentId, s.sessionId),
          })}
        onRename={() =>
          actWhenAwake(`rename:${s.sessionId}`, () => setRenaming(true))
        }
        onDelete={() => void remove(s)}
        {...(telemetry && {
          onExportTimeline: () =>
            void downloadTelemetryExport({
              agentId,
              sessionId: s.sessionId,
              signal: "logs",
              sinceHours: TELEMETRY_MAX_SINCE_HOURS,
            }),
        })}
      />
      {renaming && (
        <RenameSessionDialog
          agentId={agentId}
          session={s}
          onClose={() => setRenaming(false)}
        />
      )}
    </div>
  );
}
