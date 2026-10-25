import { SessionMode, TELEMETRY_MAX_SINCE_HOURS } from "api-server-api";
import { type ComponentProps, useState } from "react";

import { HARNESS_ICONS, HarnessIcons } from "@/components/harness-icons";
import { cn } from "@/lib/utils";

import { queryClient } from "../../../../query-client.js";
import { useStore } from "../../../../store.js";
import type { AgentView, SessionView } from "../../../../types.js";
import {
  AgentAvatar,
  avatarMood,
} from "../../../agents/components/avatar/agent-avatar.js";
import { useActWhenAwake } from "../../../agents/hooks/use-act-when-awake.js";
import {
  useFeatures,
  useInstallCapabilities,
} from "../../../features/api/queries.js";
import { acpSessionsKeys } from "../../../sessions/api/keys.js";
import { prefetchSessionHistory } from "../../../sessions/api/queries.js";
import { backgroundWorkLabel } from "../../../sessions/components/background-work-indicator.js";
import { RenameSessionDialog } from "../../../sessions/components/rename-session-dialog.js";
import { SessionRow } from "../../../sessions/components/session-row.js";
import { useOpenSession } from "../../../sessions/hooks/use-open-session.js";
import {
  pinKey,
  readPinnedSessions,
  togglePinnedSession,
  unpinSession,
} from "../../../sessions/lib/pinned-sessions.js";
import { sessionTitleLabel } from "../../../sessions/lib/session-title.js";
import { downloadTelemetryExport } from "../../../telemetry/api/download-export.js";
import { activityTone, sessionContext } from "../../lib/sidebar-tree.js";
import { ActivityDot } from "./activity-dot.js";
import { TREE_LEADING } from "./add-row.js";

type RowState = Omit<
  ComponentProps<typeof SessionRow>,
  | "conversation"
  | "session"
  | "onResume"
  | "onRename"
  | "onDelete"
  | "className"
  | "leading"
  | "titleIcon"
  | "activityIndicators"
  | "repositoryBadges"
> & { conversation?: string };

// UNIT_BOUNDARY_DESCRIPTION: a Session row the page is on carries the mark every other current item of the tree carries, so the open Session, its Agent and Home read as one state.
export const TREE_ROW_CLASS =
  "min-w-0 gap-2.5 rounded-lg border-b-0 px-2 py-2 data-[active=true]:ring-1 data-[active=true]:ring-border-ui";

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

export function togglePinKeepingFocus(
  key: string,
  agentId: string,
  session?: SessionView,
): void {
  if (session && !readPinnedSessions().has(key))
    queryClient.setQueryData(
      acpSessionsKeys.session(agentId, session.sessionId),
      session,
    );
  // UNIT_BOUNDARY_DESCRIPTION: the pin is one of the row's menu actions, and the menu renders in a portal of its own, so the keyboard is inside the menu rather than the row when it is chosen; either place means the row had the keyboard.
  const focused = document.activeElement;
  const hadFocus =
    focused?.closest("[data-pin-key]")?.getAttribute("data-pin-key") === key ||
    (focused?.closest('[role="menu"]') ?? null) !== null;
  togglePinnedSession(key);
  if (!hadFocus) return;
  requestAnimationFrame(() => {
    (
      [
        ...document.querySelectorAll<HTMLElement>(
          `[data-pin-key="${CSS.escape(key)}"] [data-row-main]`,
        ),
      ].find((button) => !button.closest("[inert]")) ??
      document.querySelector<HTMLElement>(
        `[data-agent-id="${CSS.escape(agentId)}"] [data-agent-main]`,
      ) ??
      document.querySelector<HTMLElement>('[data-testid="sidebar-group-by"]')
    )?.focus();
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: One Session row of JanUI's sidebar tree,
 * read from its Agent's own list: the activity dot, the context line, and the
 * row's actions. A pin keeps keyboard focus on the moved row, or on its Agent
 * row when the row's new place is closed or still closing, or, in the flat
 * All sessions list, which shows no Agent rows and only its first pages, on
 * the Group by control. Rename and Delete wake the Agent and
 * run once it answers.
 */
export function TreeSessionRow({
  agentId,
  session: s,
  state,
  operable,
  pinned,
  withAgent,
  onNavigate,
}: {
  agentId: string;
  session: SessionView;
  state: RowState;
  operable: boolean;
  pinned: boolean;
  withAgent?: AgentView;
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
  const harnessIcon = !!s.harness && s.harness in HARNESS_ICONS;
  const context = sessionContext(
    harnessIcon ? { ...s, harness: null } : s,
    state.conversation,
  );
  const dot = (
    <ActivityDot
      tone={tone}
      {...(tone === "background" &&
        state.backgroundWork && {
          label: backgroundWorkLabel(state.backgroundWork),
        })}
      className={withAgent && "rounded-full bg-chrome"}
    />
  );

  return (
    <div className="relative" data-pin-key={key}>
      <SessionRow
        session={s}
        {...state}
        conversation={context}
        metaLead={withAgent && `${withAgent.name} · `}
        harnessIcon={
          harnessIcon && (
            <HarnessIcons
              harnesses={[s.harness!]}
              size="xs"
              focusable={false}
            />
          )
        }
        leading={
          withAgent ? (
            <span
              className={cn(TREE_LEADING, "relative items-start justify-start")}
            >
              <span className="relative -mt-0.5">
                <AgentAvatar
                  name={withAgent.name}
                  avatar={withAgent.avatar}
                  size={28}
                  mood={avatarMood(withAgent.state, withAgent)}
                />
                <span className="absolute -right-0.5 -bottom-0.5">{dot}</span>
              </span>
            </span>
          ) : (
            <span className={cn(TREE_LEADING, "items-center")}>{dot}</span>
          )
        }
        activityIndicators={false}
        repositoryBadges={false}
        quietPin
        className={TREE_ROW_CLASS}
        pinned={pinned}
        onTogglePin={() => togglePinKeepingFocus(key, agentId, s)}
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
