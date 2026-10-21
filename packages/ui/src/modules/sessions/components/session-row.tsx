import {
  Download,
  Edit,
  Pen,
  Pin,
  PinFilled,
  Terminal,
  Time,
  TrashCan,
} from "@carbon/icons-react";
import {
  type BackgroundWorkItemView,
  ChannelType,
  SessionMode,
  SessionType,
  type SessionView,
  type SpendSessionRow,
} from "api-server-api";
import { type ReactNode, useCallback, useEffect, useId, useRef } from "react";

import { Badge } from "@/components/ui/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { HOVER_ACTION, HOVER_YIELD } from "@/components/ui/hover-action";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { formatTimestamp, timeAgo } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import { useAgentsList } from "../../agents/api/queries.js";
import { onboardingBadge } from "../../agents/utils/agent-kind.js";
import { SessionRepositoryBadges } from "../../changes/components/session-repository-badges.js";
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import {
  amountsLabel,
  sessionSpendTitle,
} from "../../spend/lib/amounts-label.js";
import { runTimeLabel } from "../lib/run-time.js";
import { sessionTitleLabel } from "../lib/session-title.js";
import { backgroundWorkLabel } from "./background-work-indicator.js";
import { WorkingDots } from "./working-dots.js";

const MENU_PARTS = {
  dropdown: { Item: DropdownMenuItem, Separator: DropdownMenuSeparator },
  context: { Item: ContextMenuItem, Separator: ContextMenuItem },
};

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
  backgroundWork?: readonly BackgroundWorkItemView[];
  cost?: SpendSessionRow;
  conversation?: ReactNode;
  metaLead?: ReactNode;
  leading?: ReactNode;
  titleIcon?: ReactNode;
  harnessIcon?: ReactNode;
  activityIndicators?: boolean;
  repositoryBadges?: boolean;
  pinned?: boolean;
  quietPin?: boolean;
  onTogglePin?: () => void;
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
  backgroundWork = NO_WORK,
  cost,
  conversation,
  metaLead,
  leading,
  titleIcon,
  harnessIcon,
  activityIndicators = true,
  repositoryBadges = true,
  pinned = false,
  quietPin = false,
  onTogglePin,
  onResume,
  onPrefetch,
  onRename,
  onDelete,
  onExportTimeline,
  className,
}: Props) {
  const mainRef = useRef<HTMLButtonElement>(null);
  const metaId = useId();
  const afterMenu = useRef<(() => void) | null>(null);

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

  const titleLabel = sessionTitleLabel(s);
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
  const costLabel = cost ? amountsLabel(cost.amounts) : null;
  const terminal = s.mode === SessionMode.Terminal;
  const messenger =
    s.type === SessionType.ChannelSlack
      ? ChannelType.Slack
      : s.type === SessionType.ChannelTelegram
        ? ChannelType.Telegram
        : null;

  const menuProps = {
    pinned,
    ...(onTogglePin && { onTogglePin }),
    ...(onExportTimeline && { onExportTimeline }),
    onRename: () => {
      afterMenu.current = onRename;
    },
    onDelete: () => {
      afterMenu.current = onDelete;
    },
  };
  const closeContextMenu = (event: Event) => {
    const act = afterMenu.current;
    if (!act) return;
    afterMenu.current = null;
    event.preventDefault();
    mainRef.current?.focus();
    act();
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-testid="session-row"
          data-session-id={s.sessionId}
          data-active={active ? "true" : "false"}
          className={cn(
            "group relative flex items-center gap-1 px-4 py-3 cursor-pointer border-b border-border transition-colors select-none",
            "has-[[data-row-main]:focus-visible]:outline-2 has-[[data-row-main]:focus-visible]:-outline-offset-2 has-[[data-row-main]:focus-visible]:outline-accent",
            active ? "bg-muted" : "hover:bg-muted/60",
            className,
          )}
          onClick={() => onResume()}
          onPointerEnter={startDwell}
          onPointerLeave={endDwell}
          onFocus={onPrefetch}
        >
          {leading}
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <button
                ref={mainRef}
                type="button"
                data-row-main
                title={titleLabel}
                aria-current={active ? "page" : undefined}
                aria-describedby={metaId}
                className="flex min-w-0 items-center gap-1.5 text-left outline-none"
              >
                {titleIcon && (
                  <span aria-hidden className="flex shrink-0">
                    {titleIcon}
                  </span>
                )}
                <span className={`text-sm min-w-0 truncate ${titleClass}`}>
                  {titleLabel}
                </span>
                {onboarding && (
                  <Badge
                    variant={onboarding.variant}
                    size="sm"
                    className="shrink-0"
                  >
                    {onboarding.label}
                  </Badge>
                )}
              </button>
              {pinned && !quietPin && (
                <PinFilled
                  size={12}
                  aria-label="Pinned"
                  className={cn(
                    "ml-auto shrink-0 text-muted-foreground group-has-[[data-row-actions]_:focus-visible]:hidden group-has-[[data-row-actions]_[data-state=open]]:hidden hover-capable:group-hover:hidden",
                    onTogglePin && "[@media(hover:none)]:hidden",
                  )}
                />
              )}
              <div
                className={cn(
                  "flex shrink-0 items-center gap-1 hover-capable:grid hover-capable:justify-items-end hover-capable:*:[grid-area:1/1]",
                  pinned && !quietPin ? "ml-1" : "ml-auto",
                )}
              >
                <SessionIndicators
                  harnessIcon={harnessIcon}
                  scheduled={scheduled}
                  terminal={terminal}
                  messenger={messenger}
                  {...(activityIndicators && {
                    needsApproval,
                    working,
                    draft,
                    backgroundWork,
                    unread,
                  })}
                />
                <div
                  data-row-actions
                  className={cn(
                    "-mr-1 flex items-center hover-capable:w-0 hover-capable:overflow-hidden hover-capable:group-hover:w-auto hover-capable:has-[:focus-visible]:w-auto hover-capable:has-[[data-state=open]]:w-auto",
                    HOVER_ACTION,
                    quietPin &&
                      "hover-capable:group-has-[:focus-visible]:w-auto group-has-[:focus-visible]:opacity-100",
                  )}
                >
                  <RowActionsMenu
                    label="More actions"
                    testId="session-menu-button"
                    dense
                    stopPropagation
                    contentProps={{
                      onClick: (event) => event.stopPropagation(),
                      onCloseAutoFocus: (event) => {
                        const act = afterMenu.current;
                        if (!act) return;
                        afterMenu.current = null;
                        event.preventDefault();
                        mainRef.current?.focus();
                        act();
                      },
                    }}
                  >
                    <SessionMenuItems menu="dropdown" {...menuProps} />
                  </RowActionsMenu>
                </div>
              </div>
            </div>
            <span
              id={metaId}
              className="text-2xs text-muted-foreground truncate"
            >
              {metaLead}
              <span title={formatTimestamp(s.updatedAt ?? s.createdAt)}>
                {timeAgo(s.updatedAt ?? s.createdAt)}
              </span>
              {runTime && (
                <span data-testid="session-run-time">
                  {" · "}
                  {runTime}
                </span>
              )}
              {costLabel && cost && (
                <span
                  className="tabular-nums"
                  data-testid="session-spend"
                  title={sessionSpendTitle(cost)}
                >
                  {" · "}
                  {costLabel}
                </span>
              )}
              {conversation && (
                <>
                  {" · "}
                  {conversation}
                </>
              )}
            </span>
            {repositoryBadges &&
              s.repositories &&
              s.repositories.length > 0 && (
                <SessionRepositoryBadges repositories={s.repositories} />
              )}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={closeContextMenu}>
        <SessionMenuItems menu="context" {...menuProps} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function SessionMenuItems({
  menu,
  pinned,
  onTogglePin,
  onExportTimeline,
  onRename,
  onDelete,
}: {
  menu: keyof typeof MENU_PARTS;
  pinned: boolean;
  onTogglePin?: (() => void) | undefined;
  onExportTimeline?: (() => void) | undefined;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { Item } = MENU_PARTS[menu];
  return (
    <>
      {onTogglePin && (
        <Item data-testid="session-pin-button" onSelect={() => onTogglePin()}>
          {pinned ? <PinFilled size={14} /> : <Pin size={14} />}{" "}
          {pinned ? "Unpin session" : "Pin to top"}
        </Item>
      )}
      {onExportTimeline && (
        <Item
          data-testid="session-export-timeline-button"
          onSelect={onExportTimeline}
        >
          <Download size={14} /> Export telemetry
        </Item>
      )}
      <Item data-testid="session-rename-button" onSelect={onRename}>
        <Edit size={14} /> Rename session
      </Item>
      <Item
        data-testid="session-delete-button"
        tone="danger"
        onSelect={onDelete}
      >
        <TrashCan size={14} /> Delete session
      </Item>
    </>
  );
}

function SessionIndicators({
  harnessIcon,
  scheduled,
  terminal,
  messenger,
  needsApproval = false,
  working = false,
  draft = false,
  backgroundWork = NO_WORK,
  unread = false,
}: {
  harnessIcon?: ReactNode;
  scheduled: boolean;
  terminal: boolean;
  messenger: ChannelType | null;
  needsApproval?: boolean;
  working?: boolean;
  draft?: boolean;
  backgroundWork?: readonly BackgroundWorkItemView[];
  unread?: boolean;
}) {
  const hasBackgroundWork = backgroundWork.length > 0;
  if (
    !harnessIcon &&
    !scheduled &&
    !terminal &&
    !messenger &&
    !needsApproval &&
    !working &&
    !hasBackgroundWork &&
    !draft &&
    !unread
  )
    return null;
  return (
    <span
      className={cn("flex shrink-0 items-center gap-2.5 pl-2", HOVER_YIELD)}
    >
      {harnessIcon}
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
          <Pen size={16} />
        </span>
      ) : unread ? (
        <IndicatorBox>
          <span
            data-testid="session-unread-dot"
            role="img"
            aria-label="Unread"
            className="size-2 rounded-full bg-accent"
          />
        </IndicatorBox>
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
