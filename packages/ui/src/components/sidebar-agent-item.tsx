import { OverflowMenuVertical, Time } from "@carbon/icons-react";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { AgentDisplay } from "../modules/agents/utils/agent-resolver.js";
import { ConnectionIcon } from "../modules/connections/components/connection-icon.js";
import type { SessionListInclude } from "../modules/sessions/api/queries.js";
import { useAcpSessions } from "../modules/sessions/api/queries.js";
import { useStore } from "../store.js";
import type { AgentView } from "../types.js";
import type { SidebarGroup } from "./sidebar-agent-list.js";
import { SidebarSessionItem } from "./sidebar-session-item.js";

const DOT_COLOR: Record<SidebarGroup, string> = {
  working: "bg-green-500",
  idle: "bg-blue-400",
  hibernating: "bg-muted-foreground/50",
};

const DOT_LABEL: Record<SidebarGroup, string> = {
  working: "Working",
  idle: "Idle",
  hibernating: "Hibernating",
};

const DOT_COLOR_TEXT: Record<SidebarGroup, string> = {
  working: "text-green-500",
  idle: "text-blue-400",
  hibernating: "text-muted-foreground/50",
};

function formatCpu(raw: string): string {
  const m = raw.match(/^(\d+)m$/);
  if (m) return `${Number(m[1]) / 1000} CPU`;
  return `${raw} CPU`;
}

function formatMemory(raw: string): string {
  const gi = raw.match(/^(\d+)Gi$/);
  if (gi) return `${gi[1]} Gi`;
  const mi = raw.match(/^(\d+)Mi$/);
  if (mi) return `${mi[1]} Mi`;
  return raw;
}

function computeSubtitle(size: { cpu?: string; memory?: string }): string {
  const parts: string[] = [];
  if (size.cpu) parts.push(formatCpu(size.cpu));
  if (size.memory) parts.push(formatMemory(size.memory));
  return parts.join(" · ") || "";
}

const SIDEBAR_SESSION_INCLUDE: SessionListInclude = {
  channels: false,
  scheduled: false,
};

export interface SidebarAgentItemProps {
  agent: AgentView;
  display: AgentDisplay;
  group: SidebarGroup;
  variant: number;
  scheduleCount: number;
  deletePending: boolean;
  onConfigure: () => void;
  onWake: () => void;
  onRestart: () => void;
  onPause: () => void;
  onStop: () => void;
  onDelete: () => void;
}

export function SidebarAgentItem({
  agent,
  display,
  group,
  variant,
  scheduleCount,
  deletePending,
  onConfigure,
  onWake,
  onRestart,
  onPause,
  onStop,
  onDelete,
}: SidebarAgentItemProps) {
  const expanded = useStore((s) => s.expandedSidebarAgents.has(agent.id));
  const toggle = useStore((s) => s.toggleSidebarAgent);
  const showMore = useStore((s) => s.showMoreSidebarSessions);
  const limit = useStore((s) => s.sidebarSessionLimits.get(agent.id) ?? 3);
  const selectedAgent = useStore((s) => s.selectedAgent);
  const active = selectedAgent === agent.id;

  const { data: sessions, isFetching } = useAcpSessions(
    agent.id,
    SIDEBAR_SESSION_INCLUDE,
    { enabled: expanded },
  );

  const visibleSessions = useMemo(
    () => (sessions ?? []).slice(0, limit),
    [sessions, limit],
  );
  const hasMore = (sessions?.length ?? 0) > limit;

  const slackChannels = agent.channels.filter((c) => c.type === "slack") as {
    type: "slack";
    slackChannelId: string;
  }[];
  const hasSlack = slackChannels.length > 0;
  const hasSchedules = scheduleCount > 0;
  const subtitle = agent.size ? computeSubtitle(agent.size) : "";
  const hasMeta = hasSlack || hasSchedules;
  const isRunning = group === "working";

  return (
    <div>
      <RowVariant
        variant={variant}
        agent={agent}
        display={display}
        group={group}
        active={active}
        subtitle={subtitle}
        hasMeta={hasMeta}
        hasSlack={hasSlack}
        hasSchedules={hasSchedules}
        slackCount={slackChannels.length}
        scheduleCount={scheduleCount}
        isRunning={isRunning}
        deletePending={deletePending}
        onToggle={() => toggle(agent.id)}
        onConfigure={onConfigure}
        onWake={onWake}
        onRestart={onRestart}
        onPause={onPause}
        onStop={onStop}
        onDelete={onDelete}
      />

      {expanded && (
        <SessionsPanel
          variant={variant}
          agentId={agent.id}
          sessions={visibleSessions}
          isFetching={isFetching}
          hasData={!!sessions}
          isEmpty={sessions?.length === 0}
          hasMore={hasMore}
          onShowMore={() => showMore(agent.id)}
        />
      )}
    </div>
  );
}

/* ─── Shared sub-components ───────────────────────────────────────────────── */

function OverflowMenu({
  display,
  isRunning,
  deletePending,
  onConfigure,
  onWake,
  onRestart,
  onPause,
  onStop,
  onDelete,
}: {
  display: AgentDisplay;
  isRunning: boolean;
  deletePending: boolean;
  onConfigure: () => void;
  onWake: () => void;
  onRestart: () => void;
  onPause: () => void;
  onStop: () => void;
  onDelete: () => void;
}) {
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Agent actions"
          >
            <OverflowMenuVertical size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onConfigure}>
            Configure agent
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {display.powerAction === "start" ? (
            <DropdownMenuItem onSelect={onWake}>
              {display.state === "over_budget" ? "Start" : "Wake"}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              disabled={display.powerAction === null}
              onSelect={onRestart}
            >
              Restart
            </DropdownMenuItem>
          )}
          {isRunning && (
            <>
              <DropdownMenuItem onSelect={onPause}>
                Pause — wakes on next use
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onStop}>
                Stop — until started again
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            tone="danger"
            disabled={deletePending}
            onSelect={onDelete}
          >
            Delete agent
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function MetaBadges({
  hasSlack,
  hasSchedules,
  slackCount,
  scheduleCount,
}: {
  hasSlack: boolean;
  hasSchedules: boolean;
  slackCount: number;
  scheduleCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {hasSlack && (
        <Badge variant="muted" className="gap-1.5">
          <ConnectionIcon iconSlug="slack" alt="" size={16} />
          {slackCount}
        </Badge>
      )}
      {hasSchedules && (
        <Badge variant="muted" className="gap-1.5">
          <Time size={16} />
          {scheduleCount}
        </Badge>
      )}
    </div>
  );
}

function MetaInline({
  hasSlack,
  hasSchedules,
  slackCount,
  scheduleCount,
}: {
  hasSlack: boolean;
  hasSchedules: boolean;
  slackCount: number;
  scheduleCount: number;
}) {
  const parts: string[] = [];
  if (hasSlack) parts.push(`${slackCount} Slack`);
  if (hasSchedules) parts.push(`${scheduleCount} sched`);
  if (parts.length === 0) return null;
  return (
    <span className="text-xs text-muted-foreground">{parts.join(" · ")}</span>
  );
}

function SessionsPanel({
  variant,
  agentId,
  sessions,
  isFetching,
  hasData,
  isEmpty,
  hasMore,
  onShowMore,
}: {
  variant: number;
  agentId: string;
  sessions: {
    sessionId: string;
    title: string | null;
    running: boolean;
    updatedAt: string | null;
  }[];
  isFetching: boolean;
  hasData: boolean;
  isEmpty: boolean | undefined;
  hasMore: boolean;
  onShowMore: () => void;
}) {
  const ml = variant === 5 ? "ml-4" : variant === 3 ? "ml-6" : "ml-8";

  return (
    <div
      className={`${ml} mt-1 flex flex-col gap-0.5 border-l border-border pl-3`}
    >
      {isFetching && !hasData && (
        <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
          <Spinner className="size-3" />
          <span>Loading…</span>
        </div>
      )}
      {isEmpty && (
        <p className="px-2 py-1.5 text-sm text-muted-foreground">
          No sessions yet
        </p>
      )}
      {sessions.map((s) => (
        <SidebarSessionItem
          key={s.sessionId}
          agentId={agentId}
          sessionId={s.sessionId}
          title={s.title}
          running={!!s.running}
          updatedAt={s.updatedAt}
        />
      ))}
      {hasMore && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onShowMore();
          }}
          className="px-2 py-1 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Show more
        </button>
      )}
    </div>
  );
}

/* ─── 10 Layout Variants ──────────────────────────────────────────────────── */

interface RowVariantProps {
  variant: number;
  agent: AgentView;
  display: AgentDisplay;
  group: SidebarGroup;
  active: boolean;
  subtitle: string;
  hasMeta: boolean;
  hasSlack: boolean;
  hasSchedules: boolean;
  slackCount: number;
  scheduleCount: number;
  isRunning: boolean;
  deletePending: boolean;
  onToggle: () => void;
  onConfigure: () => void;
  onWake: () => void;
  onRestart: () => void;
  onPause: () => void;
  onStop: () => void;
  onDelete: () => void;
}

function RowVariant(props: RowVariantProps) {
  switch (props.variant) {
    case 1:
      return <V1Breathable {...props} />;
    case 2:
      return <V2Card {...props} />;
    case 3:
      return <V3Compact {...props} />;
    case 4:
      return <V4Spacious {...props} />;
    case 5:
      return <V5MinimalDot {...props} />;
    case 6:
      return <V6Separated {...props} />;
    case 7:
      return <V7TwoRow {...props} />;
    case 8:
      return <V8CountedLine {...props} />;
    case 9:
      return <V9Warm {...props} />;
    case 10:
      return <V10Magazine {...props} />;
    default:
      return <V1Breathable {...props} />;
  }
}

/* ── V1: Breathable — generous padding, open feel ─────────────────────────── */
function V1Breathable(p: RowVariantProps) {
  return (
    <div
      className={cn(
        "group/agent relative flex w-full gap-3.5 rounded-xl px-4 py-5 text-left transition-colors",
        p.active ? "bg-[#f4f4f4]/50 dark:bg-white/[0.03]" : "hover:bg-muted/50",
      )}
    >
      <div className="relative shrink-0">
        <div className="size-10 rounded-xl border border-border bg-white dark:bg-white/5" />
        <Tooltip content={DOT_LABEL[p.group]} side="right">
          <span
            className={cn(
              "absolute -left-0.5 top-0 size-2.5 rounded-full border-2 border-background",
              DOT_COLOR[p.group],
            )}
          />
        </Tooltip>
      </div>
      <button
        type="button"
        onClick={p.onToggle}
        className="min-w-0 flex-1 text-left"
      >
        <p className="truncate text-sm font-semibold leading-snug text-foreground">
          {p.agent.name}
        </p>
        {p.subtitle && (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {p.subtitle}
          </p>
        )}
        {p.hasMeta && (
          <div className="mt-2">
            <MetaBadges
              hasSlack={p.hasSlack}
              hasSchedules={p.hasSchedules}
              slackCount={p.slackCount}
              scheduleCount={p.scheduleCount}
            />
          </div>
        )}
      </button>
      <div className="shrink-0 pt-0.5 opacity-0 transition-opacity group-hover/agent:opacity-100">
        <OverflowMenu
          display={p.display}
          isRunning={p.isRunning}
          deletePending={p.deletePending}
          onConfigure={p.onConfigure}
          onWake={p.onWake}
          onRestart={p.onRestart}
          onPause={p.onPause}
          onStop={p.onStop}
          onDelete={p.onDelete}
        />
      </div>
    </div>
  );
}

/* ── V2: Card — bordered card per agent ───────────────────────────────────── */
function V2Card(p: RowVariantProps) {
  return (
    <div
      className={cn(
        "group/agent relative mx-3 flex gap-3 rounded-xl border px-4 py-4 text-left transition-colors",
        p.active
          ? "border-border bg-[#f4f4f4]/50 dark:bg-white/[0.03]"
          : "border-transparent hover:border-border hover:bg-muted/30",
      )}
    >
      <div className="relative shrink-0">
        <div className="size-10 rounded-xl border border-border bg-white dark:bg-white/5" />
        <Tooltip content={DOT_LABEL[p.group]} side="right">
          <span
            className={cn(
              "absolute -left-0.5 top-0 size-2.5 rounded-full border-2 border-background",
              DOT_COLOR[p.group],
            )}
          />
        </Tooltip>
      </div>
      <button
        type="button"
        onClick={p.onToggle}
        className="min-w-0 flex-1 text-left"
      >
        <p className="truncate text-sm font-semibold leading-snug text-foreground">
          {p.agent.name}
        </p>
        {p.subtitle && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {p.subtitle}
          </p>
        )}
        {p.hasMeta && (
          <div className="mt-2">
            <MetaBadges
              hasSlack={p.hasSlack}
              hasSchedules={p.hasSchedules}
              slackCount={p.slackCount}
              scheduleCount={p.scheduleCount}
            />
          </div>
        )}
      </button>
      <div className="shrink-0 pt-0.5 opacity-0 transition-opacity group-hover/agent:opacity-100">
        <OverflowMenu
          display={p.display}
          isRunning={p.isRunning}
          deletePending={p.deletePending}
          onConfigure={p.onConfigure}
          onWake={p.onWake}
          onRestart={p.onRestart}
          onPause={p.onPause}
          onStop={p.onStop}
          onDelete={p.onDelete}
        />
      </div>
    </div>
  );
}

/* ── V3: Compact — tight list, small avatar, name-only ────────────────────── */
function V3Compact(p: RowVariantProps) {
  return (
    <div
      className={cn(
        "group/agent relative flex w-full items-center gap-2.5 rounded-lg px-4 py-2 text-left transition-colors",
        p.active ? "bg-[#f4f4f4]/50 dark:bg-white/[0.03]" : "hover:bg-muted/50",
      )}
    >
      <div className="relative shrink-0">
        <div className="size-8 rounded-lg border border-border bg-white dark:bg-white/5" />
        <Tooltip content={DOT_LABEL[p.group]} side="right">
          <span
            className={cn(
              "absolute -left-0.5 -top-0.5 size-2 rounded-full border-[1.5px] border-background",
              DOT_COLOR[p.group],
            )}
          />
        </Tooltip>
      </div>
      <button
        type="button"
        onClick={p.onToggle}
        className="min-w-0 flex-1 text-left"
      >
        <p className="truncate text-sm font-medium text-foreground">
          {p.agent.name}
        </p>
      </button>
      <div className="shrink-0 opacity-0 transition-opacity group-hover/agent:opacity-100">
        <OverflowMenu
          display={p.display}
          isRunning={p.isRunning}
          deletePending={p.deletePending}
          onConfigure={p.onConfigure}
          onWake={p.onWake}
          onRestart={p.onRestart}
          onPause={p.onPause}
          onStop={p.onStop}
          onDelete={p.onDelete}
        />
      </div>
    </div>
  );
}

/* ── V4: Spacious — lots of whitespace, relaxed feel ──────────────────────── */
function V4Spacious(p: RowVariantProps) {
  return (
    <div
      className={cn(
        "group/agent relative flex w-full gap-4 rounded-2xl px-5 py-5 text-left transition-colors",
        p.active ? "bg-[#f4f4f4]/50 dark:bg-white/[0.03]" : "hover:bg-muted/50",
      )}
    >
      <div className="relative shrink-0">
        <div className="size-10 rounded-xl border border-border bg-white dark:bg-white/5" />
        <Tooltip content={DOT_LABEL[p.group]} side="right">
          <span
            className={cn(
              "absolute -left-0.5 top-0 size-2.5 rounded-full border-2 border-background",
              DOT_COLOR[p.group],
            )}
          />
        </Tooltip>
      </div>
      <button
        type="button"
        onClick={p.onToggle}
        className="min-w-0 flex-1 text-left"
      >
        <p className="truncate text-[15px] font-semibold leading-snug text-foreground">
          {p.agent.name}
        </p>
        {p.subtitle && (
          <p className="mt-1.5 truncate text-xs text-muted-foreground">
            {p.subtitle}
          </p>
        )}
        {p.hasMeta && (
          <div className="mt-3">
            <MetaBadges
              hasSlack={p.hasSlack}
              hasSchedules={p.hasSchedules}
              slackCount={p.slackCount}
              scheduleCount={p.scheduleCount}
            />
          </div>
        )}
      </button>
      <div className="shrink-0 pt-0.5 opacity-0 transition-opacity group-hover/agent:opacity-100">
        <OverflowMenu
          display={p.display}
          isRunning={p.isRunning}
          deletePending={p.deletePending}
          onConfigure={p.onConfigure}
          onWake={p.onWake}
          onRestart={p.onRestart}
          onPause={p.onPause}
          onStop={p.onStop}
          onDelete={p.onDelete}
        />
      </div>
    </div>
  );
}

/* ── V5: Minimal dot — no avatar, colored dot inline before name ──────────── */
function V5MinimalDot(p: RowVariantProps) {
  return (
    <div
      className={cn(
        "group/agent relative flex w-full items-start gap-2.5 rounded-xl px-4 py-3.5 text-left transition-colors",
        p.active ? "bg-[#f4f4f4]/50 dark:bg-white/[0.03]" : "hover:bg-muted/50",
      )}
    >
      <Tooltip content={DOT_LABEL[p.group]} side="right">
        <span
          className={cn(
            "mt-1.5 size-2.5 shrink-0 rounded-full",
            DOT_COLOR[p.group],
          )}
        />
      </Tooltip>
      <button
        type="button"
        onClick={p.onToggle}
        className="min-w-0 flex-1 text-left"
      >
        <p className="truncate text-sm font-semibold leading-snug text-foreground">
          {p.agent.name}
        </p>
        {p.subtitle && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {p.subtitle}
          </p>
        )}
        {p.hasMeta && (
          <div className="mt-1.5">
            <MetaBadges
              hasSlack={p.hasSlack}
              hasSchedules={p.hasSchedules}
              slackCount={p.slackCount}
              scheduleCount={p.scheduleCount}
            />
          </div>
        )}
      </button>
      <div className="shrink-0 opacity-0 transition-opacity group-hover/agent:opacity-100">
        <OverflowMenu
          display={p.display}
          isRunning={p.isRunning}
          deletePending={p.deletePending}
          onConfigure={p.onConfigure}
          onWake={p.onWake}
          onRestart={p.onRestart}
          onPause={p.onPause}
          onStop={p.onStop}
          onDelete={p.onDelete}
        />
      </div>
    </div>
  );
}

/* ── V6: Separated — bottom border between items ──────────────────────────── */
function V6Separated(p: RowVariantProps) {
  return (
    <div
      className={cn(
        "group/agent relative flex w-full gap-3.5 border-b border-border/50 px-5 py-4 text-left transition-colors last:border-b-0",
        p.active ? "bg-[#f4f4f4]/50 dark:bg-white/[0.03]" : "hover:bg-muted/30",
      )}
    >
      <div className="relative shrink-0">
        <div className="size-10 rounded-xl border border-border bg-white dark:bg-white/5" />
        <Tooltip content={DOT_LABEL[p.group]} side="right">
          <span
            className={cn(
              "absolute -left-0.5 top-0 size-2.5 rounded-full border-2 border-background",
              DOT_COLOR[p.group],
            )}
          />
        </Tooltip>
      </div>
      <button
        type="button"
        onClick={p.onToggle}
        className="min-w-0 flex-1 text-left"
      >
        <p className="truncate text-sm font-semibold leading-snug text-foreground">
          {p.agent.name}
        </p>
        {p.subtitle && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {p.subtitle}
          </p>
        )}
        {p.hasMeta && (
          <div className="mt-2">
            <MetaBadges
              hasSlack={p.hasSlack}
              hasSchedules={p.hasSchedules}
              slackCount={p.slackCount}
              scheduleCount={p.scheduleCount}
            />
          </div>
        )}
      </button>
      <div className="shrink-0 pt-0.5 opacity-0 transition-opacity group-hover/agent:opacity-100">
        <OverflowMenu
          display={p.display}
          isRunning={p.isRunning}
          deletePending={p.deletePending}
          onConfigure={p.onConfigure}
          onWake={p.onWake}
          onRestart={p.onRestart}
          onPause={p.onPause}
          onStop={p.onStop}
          onDelete={p.onDelete}
        />
      </div>
    </div>
  );
}

/* ── V7: Two-row — name top, meta bottom with clear gap ───────────────────── */
function V7TwoRow(p: RowVariantProps) {
  return (
    <div
      className={cn(
        "group/agent relative flex w-full gap-3.5 rounded-xl px-5 py-4 text-left transition-colors",
        p.active ? "bg-[#f4f4f4]/50 dark:bg-white/[0.03]" : "hover:bg-muted/50",
      )}
    >
      <div className="relative shrink-0 pt-0.5">
        <div className="size-10 rounded-xl border border-border bg-white dark:bg-white/5" />
        <Tooltip content={DOT_LABEL[p.group]} side="right">
          <span
            className={cn(
              "absolute -left-0.5 top-0 size-2.5 rounded-full border-2 border-background",
              DOT_COLOR[p.group],
            )}
          />
        </Tooltip>
      </div>
      <button
        type="button"
        onClick={p.onToggle}
        className="min-w-0 flex-1 text-left"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-semibold text-foreground">
            {p.agent.name}
          </p>
          {p.subtitle && (
            <span className="shrink-0 text-xs text-muted-foreground/70">
              {p.subtitle}
            </span>
          )}
        </div>
        {p.hasMeta && (
          <div className="mt-2.5">
            <MetaBadges
              hasSlack={p.hasSlack}
              hasSchedules={p.hasSchedules}
              slackCount={p.slackCount}
              scheduleCount={p.scheduleCount}
            />
          </div>
        )}
      </button>
      <div className="shrink-0 pt-0.5 opacity-0 transition-opacity group-hover/agent:opacity-100">
        <OverflowMenu
          display={p.display}
          isRunning={p.isRunning}
          deletePending={p.deletePending}
          onConfigure={p.onConfigure}
          onWake={p.onWake}
          onRestart={p.onRestart}
          onPause={p.onPause}
          onStop={p.onStop}
          onDelete={p.onDelete}
        />
      </div>
    </div>
  );
}

/* ── V8: Counted line — moderate density, divider headers ─────────────────── */
function V8CountedLine(p: RowVariantProps) {
  return (
    <div
      className={cn(
        "group/agent relative flex w-full gap-3 rounded-xl px-4 py-3.5 text-left transition-colors",
        p.active ? "bg-[#f4f4f4]/50 dark:bg-white/[0.03]" : "hover:bg-muted/50",
      )}
    >
      <div className="relative shrink-0 pt-0.5">
        <div className="size-10 rounded-xl border border-border bg-white dark:bg-white/5" />
        <Tooltip content={DOT_LABEL[p.group]} side="right">
          <span
            className={cn(
              "absolute -left-0.5 top-0 size-2.5 rounded-full border-2 border-background",
              DOT_COLOR[p.group],
            )}
          />
        </Tooltip>
      </div>
      <button
        type="button"
        onClick={p.onToggle}
        className="min-w-0 flex-1 text-left"
      >
        <p className="truncate text-sm font-semibold leading-snug text-foreground">
          {p.agent.name}
        </p>
        {(p.subtitle || p.hasMeta) && (
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            {p.subtitle && <span>{p.subtitle}</span>}
            {p.subtitle && p.hasMeta && <span>·</span>}
            <MetaInline
              hasSlack={p.hasSlack}
              hasSchedules={p.hasSchedules}
              slackCount={p.slackCount}
              scheduleCount={p.scheduleCount}
            />
          </div>
        )}
      </button>
      <div className="shrink-0 pt-0.5 opacity-0 transition-opacity group-hover/agent:opacity-100">
        <OverflowMenu
          display={p.display}
          isRunning={p.isRunning}
          deletePending={p.deletePending}
          onConfigure={p.onConfigure}
          onWake={p.onWake}
          onRestart={p.onRestart}
          onPause={p.onPause}
          onStop={p.onStop}
          onDelete={p.onDelete}
        />
      </div>
    </div>
  );
}

/* ── V9: Warm — sentence-case headers, softer feel, inline meta ───────────── */
function V9Warm(p: RowVariantProps) {
  return (
    <div
      className={cn(
        "group/agent relative flex w-full gap-3 rounded-xl px-4 py-4 text-left transition-colors",
        p.active ? "bg-[#f4f4f4]/50 dark:bg-white/[0.03]" : "hover:bg-muted/40",
      )}
    >
      <div className="relative shrink-0 pt-0.5">
        <div className="size-10 rounded-full border border-border bg-white dark:bg-white/5" />
        <Tooltip content={DOT_LABEL[p.group]} side="right">
          <span
            className={cn(
              "absolute -left-0.5 top-0 size-2.5 rounded-full border-2 border-background",
              DOT_COLOR[p.group],
            )}
          />
        </Tooltip>
      </div>
      <button
        type="button"
        onClick={p.onToggle}
        className="min-w-0 flex-1 text-left"
      >
        <p className="truncate text-sm font-semibold leading-snug text-foreground">
          {p.agent.name}
        </p>
        {p.subtitle && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {p.subtitle}
          </p>
        )}
        {p.hasMeta && (
          <div className="mt-2">
            <MetaBadges
              hasSlack={p.hasSlack}
              hasSchedules={p.hasSchedules}
              slackCount={p.slackCount}
              scheduleCount={p.scheduleCount}
            />
          </div>
        )}
      </button>
      <div className="shrink-0 pt-0.5 opacity-0 transition-opacity group-hover/agent:opacity-100">
        <OverflowMenu
          display={p.display}
          isRunning={p.isRunning}
          deletePending={p.deletePending}
          onConfigure={p.onConfigure}
          onWake={p.onWake}
          onRestart={p.onRestart}
          onPause={p.onPause}
          onStop={p.onStop}
          onDelete={p.onDelete}
        />
      </div>
    </div>
  );
}

/* ── V10: Magazine — extra vertical space, prominent name, very subtle meta ── */
function V10Magazine(p: RowVariantProps) {
  return (
    <div
      className={cn(
        "group/agent relative flex w-full gap-4 rounded-2xl px-5 py-6 text-left transition-colors",
        p.active ? "bg-[#f4f4f4]/50 dark:bg-white/[0.03]" : "hover:bg-muted/40",
      )}
    >
      <div className="relative shrink-0">
        <div className="size-12 rounded-xl border border-border bg-white dark:bg-white/5" />
        <Tooltip content={DOT_LABEL[p.group]} side="right">
          <span
            className={cn(
              "absolute -left-0.5 top-0 size-2.5 rounded-full border-2 border-background",
              DOT_COLOR[p.group],
            )}
          />
        </Tooltip>
      </div>
      <button
        type="button"
        onClick={p.onToggle}
        className="min-w-0 flex-1 text-left"
      >
        <p className="truncate text-[15px] font-semibold leading-tight text-foreground">
          {p.agent.name}
        </p>
        {p.subtitle && (
          <p className="mt-1.5 truncate text-xs text-muted-foreground/70">
            {p.subtitle}
          </p>
        )}
        {p.hasMeta && (
          <div className="mt-3">
            <MetaBadges
              hasSlack={p.hasSlack}
              hasSchedules={p.hasSchedules}
              slackCount={p.slackCount}
              scheduleCount={p.scheduleCount}
            />
          </div>
        )}
      </button>
      <div className="shrink-0 pt-0.5 opacity-0 transition-opacity group-hover/agent:opacity-100">
        <OverflowMenu
          display={p.display}
          isRunning={p.isRunning}
          deletePending={p.deletePending}
          onConfigure={p.onConfigure}
          onWake={p.onWake}
          onRestart={p.onRestart}
          onPause={p.onPause}
          onStop={p.onStop}
          onDelete={p.onDelete}
        />
      </div>
    </div>
  );
}
