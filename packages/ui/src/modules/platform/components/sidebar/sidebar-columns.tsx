import { AddAlt, Book, Settings, Tools } from "@carbon/icons-react";
import { useMemo, useState } from "react";

import { SectionLabel } from "@/components/ui/section-label";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { DOCS_URL } from "../../../../constants.js";
import { useStore } from "../../../../store.js";
import type { AgentView } from "../../../../types.js";
import { useAgentsList } from "../../../agents/api/queries.js";
import {
  AgentAvatar,
  avatarMood,
} from "../../../agents/components/avatar/agent-avatar.js";
import { useCreateDefaultAgent } from "../../../agents/hooks/use-create-default-agent.js";
import { useSidebarAgents } from "../../../agents/hooks/use-sidebar-agents.js";
import { useSidebarOrderActions } from "../../../agents/hooks/use-sidebar-order-actions.js";
import { ActivityFilterMenu } from "../../../home/components/activity-filter-menu.js";
import { useActivityConversations } from "../../../home/hooks/use-activity-conversations.js";
import {
  type AgentActivitySession,
  useActivitySessions,
} from "../../../home/hooks/use-activity-sessions.js";
import { useWaitingApprovals } from "../../../home/hooks/use-waiting-approvals.js";
import { filterActivitySessions } from "../../../home/lib/activity-sessions.js";
import { provisionalSessionView } from "../../../sessions/api/queries.js";
import { RenameSessionDialog } from "../../../sessions/components/rename-session-dialog.js";
import { SessionRow } from "../../../sessions/components/session-row.js";
import { SidebarAgentSessions } from "../../../sessions/components/sidebar-agent-sessions.js";
import { useOpenSession } from "../../../sessions/hooks/use-open-session.js";
import { useOpenSidePanel } from "../../../sessions/hooks/use-open-side-panel.js";
import { useStartSession } from "../../../sessions/hooks/use-start-session.js";

const ROW = "min-w-0 rounded-lg border-b-0 px-2 py-2";
const RECENT_LIMIT = 40;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The sidebar's two columns. The left column is a
 * strip of agent avatars, each badged with how many of its sessions are
 * unread or wait for an approval. The right column lists conversations: under
 * All, the sessions that need the user and then every session by latest
 * activity; under one agent, that agent's own session list.
 */
export function SidebarColumns({
  onNavigate,
  footer,
}: {
  onNavigate?: () => void;
  footer?: React.ReactNode;
}) {
  const { agents, openAgentId } = useSidebarAgents();
  const activity = useActivitySessions();
  const approvals = useWaitingApprovals();
  const selected = useStore((s) => s.sidebarAgentId);
  const setSelected = useStore((s) => s.setSidebarAgentId);
  const shownAgentId =
    selected && agents.some((a) => a.id === selected) ? selected : null;

  const needsYou = useMemo(() => {
    const counts = new Map<string, number>();
    const bump = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const item of activity.items)
      if (item.unread) bump(item.session.agentId);
    for (const item of approvals) bump(item.agentId);
    return counts;
  }, [activity.items, approvals]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <AvatarStrip
        agents={agents}
        selected={shownAgentId}
        current={openAgentId}
        needsYou={needsYou}
        onSelect={setSelected}
        onNavigate={onNavigate}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {shownAgentId ? (
          <AgentColumn
            agent={agents.find((a) => a.id === shownAgentId)!}
            onNavigate={onNavigate}
          />
        ) : (
          <AllColumn
            items={activity.items}
            approvalCount={approvals.length}
            unreadable={activity.unreadable}
            onNavigate={onNavigate}
          />
        )}
        {footer}
      </div>
    </div>
  );
}

function AvatarStrip({
  agents,
  selected,
  current,
  needsYou,
  onSelect,
  onNavigate,
}: {
  agents: readonly AgentView[];
  selected: string | null;
  current: string | null;
  needsYou: ReadonlyMap<string, number>;
  onSelect: (agentId: string | null) => void;
  onNavigate?: () => void;
}) {
  const defaultAgent = useCreateDefaultAgent();
  const settingsOpen = useStore((s) => s.view === "settings");
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const total = [...needsYou.values()].reduce((a, b) => a + b, 0);
  return (
    <div className="flex w-[60px] shrink-0 flex-col border-r border-border">
      <div
        className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-x-hidden overflow-y-auto pt-3 pb-4 [scrollbar-width:none]"
        role="tablist"
        aria-orientation="vertical"
        aria-label="Agents"
        data-testid="sidebar-avatar-strip"
      >
        <StripButton
          label="All agents"
          active={selected === null}
          badge={total}
          onClick={() => onSelect(null)}
        >
          <span className="text-2xs font-semibold">All</span>
        </StripButton>
        <span className="h-px w-6 shrink-0 bg-border" />
        {agents.map((agent) => (
          <StripButton
            key={agent.id}
            label={agent.name}
            active={selected === agent.id}
            current={current === agent.id}
            badge={needsYou.get(agent.id) ?? 0}
            onClick={() => onSelect(agent.id)}
          >
            <AgentAvatar
              name={agent.name}
              avatar={agent.avatar}
              size={28}
              mood={avatarMood(agent.state, agent)}
            />
          </StripButton>
        ))}
        <Tooltip content="Create agent" side="right">
          <button
            type="button"
            aria-label="Create agent"
            disabled={!defaultAgent.ready}
            onClick={() => void defaultAgent.create()}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground transition-colors hover:border-border-ui hover:text-foreground disabled:opacity-50"
          >
            <AddAlt size={16} />
          </button>
        </Tooltip>
      </div>
      <div className="relative z-raised flex h-[106px] shrink-0 flex-col items-center justify-center gap-1 border-t border-border bg-card">
        <Tooltip content="Documentation" side="right">
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Documentation"
            className="flex size-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <Book size={18} />
          </a>
        </Tooltip>
        <Tooltip content="Settings" side="right">
          <button
            type="button"
            aria-label="Settings"
            aria-current={settingsOpen ? "page" : undefined}
            onClick={() => {
              navigateToSettings();
              onNavigate?.();
            }}
            className={cn(
              "flex size-10 items-center justify-center rounded-xl transition-colors",
              settingsOpen
                ? "bg-muted text-foreground ring-1 ring-border-ui"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <Settings size={18} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function StripButton({
  label,
  active,
  current = false,
  badge,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  current?: boolean;
  badge: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={label} side="right">
      <button
        type="button"
        role="tab"
        aria-selected={active}
        aria-label={badge > 0 ? `${label}, ${badge} need you` : label}
        onClick={onClick}
        className={cn(
          "group relative flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-all",
          active
            ? "bg-muted text-foreground ring-1 ring-border-ui"
            : "hover:bg-muted/60 hover:text-foreground",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute -left-2.5 w-1 rounded-r-full bg-foreground transition-all",
            active ? "h-6" : current ? "h-2" : "h-0 group-hover:h-2",
          )}
        />
        {children}
        {badge > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] leading-none font-bold text-background ring-2 ring-card tabular-nums">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </button>
    </Tooltip>
  );
}

function ColumnHeader({
  title,
  actions,
}: {
  title: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-2 pr-2 pl-4">
      <span className="min-w-0 truncate text-sm font-semibold text-foreground">
        {title}
      </span>
      <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
    </div>
  );
}

function ListLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-raised bg-card px-2 pt-3 pb-1.5 first:pt-0">
      <SectionLabel>{children}</SectionLabel>
    </div>
  );
}

function AllColumn({
  items,
  approvalCount,
  unreadable,
  onNavigate,
}: {
  items: readonly AgentActivitySession[];
  approvalCount: number;
  unreadable: boolean;
  onNavigate?: () => void;
}) {
  const filters = useStore((s) => s.sidebarActivityFilters);
  const setFilters = useStore((s) => s.setSidebarActivityFilters);
  const openSidePanel = useOpenSidePanel();
  const agents = useAgentsList();
  const sessions = useMemo(() => items.map((item) => item.session), [items]);
  const conversationOf = useActivityConversations(sessions, agents);
  const shown = filterActivitySessions(items, filters);
  const unread = shown.filter((item) => item.unread);
  const rest = shown.filter((item) => !item.unread).slice(0, RECENT_LIMIT);
  const row = (item: AgentActivitySession) => (
    <ActivityRow
      key={item.id}
      item={item}
      conversation={conversationOf(item.session)}
      onNavigate={onNavigate}
    />
  );

  return (
    <>
      <ColumnHeader
        title="All agents"
        actions={<ActivityFilterMenu filters={filters} onChange={setFilters} />}
      />
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-3">
        {unreadable && (
          <p className="px-2.5 py-1.5 text-xs text-muted-foreground">
            Recent sessions can't be loaded right now.
          </p>
        )}
        {(approvalCount > 0 || unread.length > 0) && (
          <>
            <ListLabel>Needs you</ListLabel>
            {approvalCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  openSidePanel("approvals");
                  onNavigate?.();
                }}
                className="mb-px flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted"
              >
                <span className="flex size-[22px] shrink-0 items-center justify-center">
                  <span className="size-2 rounded-full bg-warning" />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {approvalCount === 1
                    ? "1 approval waiting"
                    : `${approvalCount} approvals waiting`}
                </span>
              </button>
            )}
            <div className="flex flex-col gap-px">{unread.map(row)}</div>
          </>
        )}
        <ListLabel>Recent</ListLabel>
        {rest.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            No sessions yet.
          </p>
        ) : (
          <div className="flex flex-col gap-px">{rest.map(row)}</div>
        )}
      </div>
    </>
  );
}

function ActivityRow({
  item,
  conversation,
  onNavigate,
}: {
  item: AgentActivitySession;
  conversation?: string;
  onNavigate?: () => void;
}) {
  const openSession = useOpenSession();
  const deleteSession = useStore((s) => s.deleteSession);
  const showConfirm = useStore((s) => s.showConfirm);
  const [renaming, setRenaming] = useState(false);
  const active = useStore(
    (s) =>
      s.view === "chat" &&
      s.selectedAgent === item.session.agentId &&
      s.sessionId === item.session.sessionId,
  );
  const session = provisionalSessionView(item.session);
  const label = session.title || session.sessionId.slice(0, 12);
  return (
    <>
      <SessionRow
        session={session}
        active={active}
        working={item.working}
        needsApproval={false}
        unread={item.unread}
        conversation={[item.agent.name, conversation]
          .filter(Boolean)
          .join(" · ")}
        className={ROW}
        leading={
          <AgentAvatar
            name={item.agent.name}
            avatar={item.agent.avatar}
            size={22}
            mood={avatarMood(item.agent.state, item.agent)}
            className="mt-0.5 mr-1.5 shrink-0 self-start"
          />
        }
        onResume={() => {
          openSession(
            item.session.agentId,
            item.session.sessionId,
            item.session.mode,
          );
          onNavigate?.();
        }}
        onRename={() => setRenaming(true)}
        onDelete={() =>
          void showConfirm(
            "Its transcript is deleted and cannot be recovered.",
            `Delete session “${label}”?`,
            { kind: "destructive", confirmLabel: "Delete session" },
          ).then(
            (ok) =>
              ok && deleteSession(item.session.sessionId, item.session.agentId),
          )
        }
      />
      {renaming && (
        <RenameSessionDialog
          agentId={item.session.agentId}
          session={session}
          onClose={() => setRenaming(false)}
        />
      )}
    </>
  );
}

function AgentColumn({
  agent,
  onNavigate,
}: {
  agent: AgentView;
  onNavigate?: () => void;
}) {
  const { sessionsOf, sessionOrderOf, previewComplete } = useSidebarAgents();
  const orderActions = useSidebarOrderActions();
  const activity = useActivitySessions();
  const agents = useAgentsList();
  const sessions = useMemo(
    () => activity.items.map((item) => item.session),
    [activity.items],
  );
  const conversationOf = useActivityConversations(sessions, agents);
  const startSession = useStartSession();
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const go = (fn: () => void) => () => {
    fn();
    onNavigate?.();
  };

  return (
    <>
      <ColumnHeader
        title={agent.name}
        actions={
          <>
            <HeaderIcon
              label="New session"
              onClick={go(() => startSession(agent.id))}
            >
              <AddAlt size={16} />
            </HeaderIcon>
            <HeaderIcon
              label="Configure agent"
              onClick={go(() => navigateToSandboxHome(agent.id))}
            >
              <Tools size={14} />
            </HeaderIcon>
          </>
        }
      />
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-3">
        <SidebarAgentSessions
          agentId={agent.id}
          open
          preview={sessionsOf(agent.id)}
          previewComplete={previewComplete}
          order={sessionOrderOf(agent.id)}
          orderActions={orderActions}
          conversationOf={conversationOf}
          stickyClassName="bg-card"
          flat
          onNavigate={onNavigate}
        />
      </div>
    </>
  );
}

function HeaderIcon({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {children}
      </button>
    </Tooltip>
  );
}
