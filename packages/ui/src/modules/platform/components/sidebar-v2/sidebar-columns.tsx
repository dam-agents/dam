import {
  Add,
  AddAlt,
  Bot,
  Box,
  Chat,
  Home,
  Settings,
  Tools,
  TrashCan,
} from "@carbon/icons-react";
import { useEffect, useMemo, useState } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RAIL_BADGE, railIndicator, railTile } from "@/components/ui/rail-tile";
import { SectionLabel } from "@/components/ui/section-label";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useStore } from "../../../../store.js";
import type { AgentView } from "../../../../types.js";
import { useDeleteAgent } from "../../../agents/api/mutations.js";
import { useAgentsList } from "../../../agents/api/queries.js";
import {
  AgentAvatar,
  avatarMood,
} from "../../../agents/components/avatar/agent-avatar.js";
import { OrderDropIndicator } from "../../../agents/components/order-drop-indicator.js";
import { useConfirmDeleteAgent } from "../../../agents/hooks/use-confirm-delete-agent.js";
import { useCreateDefaultAgent } from "../../../agents/hooks/use-create-default-agent.js";
import { useOrderDrag } from "../../../agents/hooks/use-order-drag.js";
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
import { useOpenSession } from "../../../sessions/hooks/use-open-session.js";
import { useOpenSidePanel } from "../../../sessions/hooks/use-open-side-panel.js";
import { useStartSession } from "../../../sessions/hooks/use-start-session.js";
import {
  togglePinnedSession,
  usePinnedSessions,
} from "../../../sessions/lib/pinned-sessions.js";
import { AgentSessionList } from "./agent-session-list.js";

const ROW = "min-w-0 rounded-lg border-b-0 px-2 py-2";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The sidebar's two columns. The left column is a
 * strip of agent avatars, each badged with how many of its sessions are
 * unread or wait for an approval. The right column lists conversations: under
 * All, the sessions that need the user and then every session by latest
 * activity; under one agent, that agent's own session list.
 */
export function SidebarColumns({ onNavigate }: { onNavigate?: () => void }) {
  const { agents, openAgentId } = useSidebarAgents();
  const activity = useActivitySessions();
  const approvals = useWaitingApprovals();
  const selected = useStore((s) => s.sidebarAgentId);
  const setSelected = useStore((s) => s.setSidebarAgentId);
  const setView = useStore((s) => s.setView);
  const startSession = useStartSession();
  const select = (agentId: string | null) => {
    setSelected(agentId);
    if (agentId) startSession(agentId);
    else setView("home");
    onNavigate?.();
  };
  const onHome = useStore((s) => s.view === "home");
  useEffect(() => {
    if (openAgentId) setSelected(openAgentId);
    else if (onHome) setSelected(null);
  }, [openAgentId, onHome, setSelected]);
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
        onSelect={select}
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
  const setKitBrowserOpen = useStore((s) => s.setKitBrowserOpen);
  const orderActions = useSidebarOrderActions();
  const shownIds = agents.map((agent) => agent.id);
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
          label="Home"
          active={!settingsOpen && selected === null}
          badge={total}
          onClick={() => onSelect(null)}
        >
          <Home size={18} />
        </StripButton>
        <span className="h-px w-6 shrink-0 bg-border" />
        {agents.map((agent) => (
          <DraggableAgent
            key={agent.id}
            agent={agent}
            shown={shownIds}
            orderActions={orderActions}
            active={!settingsOpen && selected === agent.id}
            current={current === agent.id}
            badge={needsYou.get(agent.id) ?? 0}
            onSelect={() => onSelect(agent.id)}
            onNavigate={onNavigate}
          />
        ))}
        <DropdownMenu>
          <Tooltip content="Create agent" side="right">
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Create agent"
                data-testid="sidebar-create-agent"
                className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground transition-colors hover:border-border-ui hover:text-foreground data-[state=open]:border-border-ui data-[state=open]:text-foreground"
              >
                <Add size={20} />
              </button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent side="right" align="end" sideOffset={8}>
            <DropdownMenuItem
              disabled={!defaultAgent.ready}
              onSelect={() => void defaultAgent.create()}
            >
              <Bot size={14} /> New agent
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setKitBrowserOpen(true)}>
              <Box size={14} /> Use a starter kit
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="relative z-raised flex shrink-0 flex-col items-center justify-center gap-1 bg-chrome py-2">
        <Tooltip content="Settings" side="right">
          <button
            type="button"
            aria-label="Settings"
            aria-current={settingsOpen ? "page" : undefined}
            onClick={() => {
              navigateToSettings();
              onNavigate?.();
            }}
            className={railTile(settingsOpen)}
          >
            <span aria-hidden className={railIndicator("left", settingsOpen)} />
            <Settings size={18} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function DraggableAgent({
  agent,
  shown,
  orderActions,
  active,
  current,
  badge,
  onSelect,
  onNavigate,
}: {
  agent: AgentView;
  shown: readonly string[];
  orderActions: ReturnType<typeof useSidebarOrderActions>;
  active: boolean;
  current: boolean;
  badge: number;
  onSelect: () => void;
  onNavigate?: () => void;
}) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const setView = useStore((s) => s.setView);
  const confirmDelete = useConfirmDeleteAgent();
  const deleteAgent = useDeleteAgent();
  const drag = useOrderDrag({
    scope: "agents",
    id: agent.id,
    ready: orderActions.ready,
    onMove: (id, drop) => orderActions.moveAgent(shown, id, drop),
    onStep: (id, step) => orderActions.stepAgent(shown, id, step),
  });
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          {...drag.dragProps}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          data-testid="sidebar-strip-agent"
          className="relative"
        >
          <StripButton
            label={agent.name}
            active={active}
            current={current}
            badge={badge}
            onClick={onSelect}
          >
            <AgentAvatar
              name={agent.name}
              avatar={agent.avatar}
              size={28}
              mood={avatarMood(agent.state, agent)}
            />
          </StripButton>
          <OrderDropIndicator at={drag.indicator} />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onSelect}>
          <Chat size={14} /> Chat
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            navigateToSandboxHome(agent.id);
            onNavigate?.();
          }}
        >
          <Tools size={14} /> Configure
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          tone="danger"
          onSelect={() =>
            void confirmDelete(agent).then((ok) => {
              if (!ok) return;
              deleteAgent.mutate({ id: agent.id });
              if (current) setView("home");
            })
          }
        >
          <TrashCan size={14} /> Remove
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
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
        className={railTile(active)}
      >
        <span aria-hidden className={railIndicator("left", active, current)} />
        {children}
        {badge > 0 && (
          <span className={cn(RAIL_BADGE, "bg-warning")}>
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
    <div className="sticky top-0 z-raised bg-chrome px-2 pt-3 pb-1.5 first:pt-0">
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
  const pins = usePinnedSessions();
  const shown = filterActivitySessions(items, filters);
  const unread = shown.filter((item) => item.unread);
  const read = shown.filter((item) => !item.unread);
  const pinned = read.filter((item) => pins.has(item.id));
  const rest = read.filter((item) => !pins.has(item.id));
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
        {pinned.length > 0 && (
          <>
            <ListLabel>Pinned</ListLabel>
            <div className="flex flex-col gap-px">{pinned.map(row)}</div>
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
  const pinned = usePinnedSessions().has(item.id);
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
        pinned={pinned}
        onTogglePin={() => togglePinnedSession(item.id)}
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
  const { sessionOrderOf } = useSidebarAgents();
  const orderActions = useSidebarOrderActions();
  const startSession = useStartSession();
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const go = (fn: () => void) => () => {
    fn();
    onNavigate?.();
  };

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-testid="sidebar-agent-column"
      data-agent-name={agent.name}
    >
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
        <AgentSessionList
          agentId={agent.id}
          order={sessionOrderOf(agent.id)}
          orderActions={orderActions}
          onNavigate={onNavigate}
        />
      </div>
    </div>
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
