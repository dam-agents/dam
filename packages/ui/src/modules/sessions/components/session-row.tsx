import { Download, Edit, Terminal, Time, TrashCan } from "@carbon/icons-react";
import {
  type BackgroundWorkItemView,
  ChannelType,
  SessionMode,
  type SessionRuntime,
  SessionType,
  type SessionView,
} from "api-server-api";
import { useCallback, useEffect, useRef, useState } from "react";

import { HarnessIcons } from "@/components/harness-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { HOVER_ACTION, HOVER_YIELD } from "@/components/ui/hover-action";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { clickableProps } from "@/lib/clickable";
import { formatTimestamp, timeAgo } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import { useAgentsList } from "../../agents/api/queries.js";
import { onboardingBadge } from "../../agents/utils/agent-kind.js";
import { SessionRepositoryBadges } from "../../changes/components/session-repository-badges.js";
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import {
  formatHarnessSpend,
  formatTokens,
  formatUsdCell,
} from "../../metrics/lib/format.js";
import { runTimeLabel } from "../lib/run-time.js";
import { backgroundWorkLabel } from "./background-work-indicator.js";
import { WorkingDots } from "./working-dots.js";

const LONG_PRESS_MS = 400;
// UNIT_BOUNDARY_DESCRIPTION: a pointer resting this long on a row reads its history ahead of the click; a pointer sweeping across the list reads nothing.
const PREFETCH_DWELL_MS = 100;

const NO_WORK: readonly BackgroundWorkItemView[] = Object.freeze([]);

interface Props {
  session: SessionView;
  active: boolean;
  working: boolean;
  needsApproval: boolean;
  unread?: boolean;
  draft?: boolean;
  provisional?: boolean;
  backgroundWork?: readonly BackgroundWorkItemView[];
  cost?: SessionRuntime;
  conversation?: string;
  reorderable?: boolean;
  onResume: () => void;
  onPrefetch?: () => void;
  onRename: () => void;
  onDelete: () => void;
  onExportTimeline?: () => void;
  className?: string;
}

export function SessionRow({
  session: s,
  active,
  working,
  needsApproval,
  unread = false,
  draft = false,
  provisional = false,
  backgroundWork = NO_WORK,
  cost,
  conversation,
  reorderable = false,
  onResume,
  onPrefetch,
  onRename,
  onDelete,
  onExportTimeline,
  className,
}: Props) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const startPress = useCallback(() => {
    didLongPress.current = false;
    if (provisional) return;
    timerRef.current = setTimeout(() => {
      didLongPress.current = true;
      setMenuOpen(true);
    }, LONG_PRESS_MS);
  }, [provisional]);

  const dwellRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startDwell = useCallback(() => {
    if (!onPrefetch || dwellRef.current) return;
    dwellRef.current = setTimeout(onPrefetch, PREFETCH_DWELL_MS);
  }, [onPrefetch]);
  const endDwell = useCallback(() => {
    if (dwellRef.current) clearTimeout(dwellRef.current);
    dwellRef.current = null;
  }, []);
  useEffect(() => endDwell, [endDwell]);

  const endPress = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleClick = useCallback(() => {
    if (didLongPress.current) {
      didLongPress.current = false;
      return;
    }
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    onResume();
  }, [onResume, menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const titleLabel = s.title || `(no title · ${s.sessionId.slice(0, 8)})`;
  const titleClass = !s.title
    ? "text-muted-foreground italic"
    : unread
      ? "font-semibold text-foreground"
      : "font-normal text-foreground";

  const scheduled =
    s.type === SessionType.ScheduleCron ||
    s.type === SessionType.ScheduleOnce ||
    !!s.scheduleId;
  const agents = useAgentsList();
  const agent = agents.find((a) => a.id === s.agentId);
  const onboarding =
    s.initialization === true && agent ? onboardingBadge(agent) : null;
  const runTime = scheduled ? runTimeLabel(s) : null;
  const terminal = s.mode === SessionMode.Terminal;
  const messenger =
    s.type === SessionType.ChannelSlack
      ? ChannelType.Slack
      : s.type === SessionType.ChannelTelegram
        ? ChannelType.Telegram
        : null;

  return (
    <div
      data-testid="session-row"
      data-session-id={s.sessionId}
      data-active={active ? "true" : "false"}
      className={cn(
        "group relative flex items-center gap-1 px-4 py-3 cursor-pointer border-b border-border transition-colors select-none",
        active ? "bg-muted" : "hover:bg-muted/60",
        className,
      )}
      {...clickableProps(handleClick)}
      aria-keyshortcuts={reorderable ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
      onPointerEnter={startDwell}
      onPointerLeave={endDwell}
      onFocus={onPrefetch}
      onTouchStart={startPress}
      onTouchEnd={endPress}
      onTouchCancel={endPress}
      onContextMenu={(e) => {
        if (provisional) return;
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className={`text-sm min-w-0 truncate ${titleClass}`}>
            {titleLabel}
          </span>
          {onboarding && (
            <Badge variant={onboarding.variant} size="sm" className="shrink-0">
              {onboarding.label}
            </Badge>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1 hover-capable:grid hover-capable:justify-items-end hover-capable:*:[grid-area:1/1]">
            <SessionIndicators
              scheduled={scheduled}
              terminal={terminal}
              messenger={messenger}
              needsApproval={needsApproval}
              working={working}
              draft={draft}
              backgroundWork={backgroundWork}
              harness={s.harness ?? null}
            />
            <div
              className={cn(
                "-mr-1 flex items-center hover-capable:w-0 hover-capable:overflow-hidden hover-capable:group-hover:w-auto hover-capable:has-[:focus-visible]:w-auto hover-capable:has-[[data-state=open]]:w-auto",
                HOVER_ACTION,
              )}
            >
              <RowActionsMenu
                label="More actions"
                testId="session-menu-button"
                dense
                stopPropagation
                contentProps={{ onClick: (event) => event.stopPropagation() }}
              >
                {onExportTimeline && (
                  <DropdownMenuItem
                    data-testid="session-export-timeline-button"
                    onSelect={onExportTimeline}
                  >
                    <Download size={14} /> Export telemetry
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  data-testid="session-rename-button"
                  disabled={provisional}
                  onSelect={onRename}
                >
                  <Edit size={14} /> Rename session
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="session-delete-button"
                  disabled={provisional}
                  tone="danger"
                  onSelect={onDelete}
                >
                  <TrashCan size={14} /> Delete session
                </DropdownMenuItem>
              </RowActionsMenu>
            </div>
          </div>
        </div>
        <span className="text-2xs text-muted-foreground truncate">
          {conversation ? `${conversation} · ` : ""}
          <span title={formatTimestamp(s.updatedAt ?? s.createdAt)}>
            {timeAgo(s.updatedAt ?? s.createdAt)}
          </span>
          {runTime && (
            <span data-testid="session-run-time">
              {" · "}
              {runTime}
            </span>
          )}
          {cost && (
            <span
              className="tabular-nums"
              title={`${cost.calls} API calls · ${formatTokens(cost.inputTokens + cost.cacheReadTokens + cost.cacheCreationTokens)} in / ${formatTokens(cost.outputTokens)} out · $${cost.costUsd.toFixed(4)}`}
            >
              {" · "}
              {formatUsdCell(cost.costUsd)}
            </span>
          )}
          {!cost && s.spend && (
            <span className="tabular-nums" data-testid="session-spend">
              {" · "}
              {formatHarnessSpend(s.spend)}
            </span>
          )}
        </span>
        {s.repositories && s.repositories.length > 0 && (
          <SessionRepositoryBadges repositories={s.repositories} />
        )}
      </div>
      {}
      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute right-3 top-2 z-popover rounded-lg border border-border bg-popover py-1 anim-scale-in shadow-md"
        >
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
              onRename();
            }}
          >
            <Edit size={14} /> Rename session
          </Button>
          <Button
            variant="ghost"
            tone="danger"
            size="sm"
            className="w-full justify-start"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
              onDelete();
            }}
          >
            <TrashCan size={14} /> Delete session
          </Button>
        </div>
      )}
    </div>
  );
}

function SessionIndicators({
  scheduled,
  terminal,
  messenger,
  needsApproval,
  working,
  draft,
  backgroundWork,
  harness,
}: {
  scheduled: boolean;
  terminal: boolean;
  messenger: ChannelType | null;
  needsApproval: boolean;
  working: boolean;
  draft: boolean;
  backgroundWork: readonly BackgroundWorkItemView[];
  harness: string | null;
}) {
  const hasBackgroundWork = backgroundWork.length > 0;
  if (
    !scheduled &&
    !terminal &&
    !messenger &&
    !needsApproval &&
    !working &&
    !hasBackgroundWork &&
    !draft &&
    !harness
  )
    return null;
  return (
    <span
      className={cn("flex shrink-0 items-center gap-2.5 pl-2", HOVER_YIELD)}
    >
      {terminal && (
        <Terminal size={16} className="text-foreground" aria-label="Terminal" />
      )}
      {scheduled && (
        <Time size={16} className="text-foreground" aria-label="Scheduled" />
      )}
      {needsApproval ? (
        <IndicatorBox>
          <span
            data-testid="session-approval-dot"
            role="img"
            aria-label="Needs your approval"
            className="w-2 h-2 rounded-full bg-warning"
          />
        </IndicatorBox>
      ) : working ? (
        <IndicatorBox>
          <WorkingDots className="text-accent" title="Working" />
        </IndicatorBox>
      ) : hasBackgroundWork ? (
        <IndicatorBox>
          <WorkingDots
            className="working-dots-slow text-success"
            title={backgroundWorkLabel(backgroundWork)}
          />
        </IndicatorBox>
      ) : draft ? (
        <span
          data-testid="session-draft-marker"
          role="img"
          aria-label="Has a draft"
          title="Has a draft"
          className="inline-flex text-muted-foreground shrink-0"
        >
          <Edit size={16} />
        </span>
      ) : harness ? (
        <span
          data-testid="session-harness"
          className="inline-flex shrink-0 text-muted-foreground"
        >
          <HarnessIcons harnesses={[harness]} size="xs" />
        </span>
      ) : null}
      {messenger && !working && (
        <ConnectionIcon
          iconSlug={messenger}
          alt={messenger === ChannelType.Slack ? "Slack" : "Telegram"}
          size={16}
          className="shrink-0"
        />
      )}
    </span>
  );
}

function IndicatorBox({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center">
      {children}
    </span>
  );
}
