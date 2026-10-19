import {
  AddAlt,
  AddComment,
  ChevronRight,
  DataEnrichmentAdd,
  Settings,
  Tools,
  TrashCan,
} from "@carbon/icons-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
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
import { useActWhenAwake } from "../../../agents/hooks/use-act-when-awake.js";
import { useConfirmDeleteAgent } from "../../../agents/hooks/use-confirm-delete-agent.js";
import { useCreateDefaultAgent } from "../../../agents/hooks/use-create-default-agent.js";
import { useOrderDrag } from "../../../agents/hooks/use-order-drag.js";
import { useSidebarAgents } from "../../../agents/hooks/use-sidebar-agents.js";
import { useSidebarOrderActions } from "../../../agents/hooks/use-sidebar-order-actions.js";
import { useApprovalsForOwner } from "../../../approvals/api/queries.js";
import { ActivityFilterMenu } from "../../../home/components/activity-filter-menu.js";
import { useActivityConversations } from "../../../home/hooks/use-activity-conversations.js";
import {
  type AgentActivitySession,
  useActivitySessions,
} from "../../../home/hooks/use-activity-sessions.js";
import { filterActivitySessions } from "../../../home/lib/activity-sessions.js";
import { provisionalSessionView } from "../../../sessions/api/queries.js";
import { RenameSessionDialog } from "../../../sessions/components/rename-session-dialog.js";
import { SessionRow } from "../../../sessions/components/session-row.js";
import { useOpenSession } from "../../../sessions/hooks/use-open-session.js";
import { useStartSession } from "../../../sessions/hooks/use-start-session.js";
import {
  togglePinnedSession,
  unpinSession,
  usePinnedSessions,
} from "../../../sessions/lib/pinned-sessions.js";
import {
  activityTone,
  awaitsApproval,
  sessionContext,
  splitPinned,
  toggleExpanded,
} from "../../lib/sidebar-tree.js";
import { ActivityDot } from "./activity-dot.js";
import { AddRow, FOCUS_RING } from "./add-row.js";
import { AgentSessionList } from "./agent-session-list.js";

const ROW = "min-w-0 rounded-lg border-b-0 px-2 py-2";
const REVEAL =
  "transition-opacity hover-capable:pointer-events-none hover-capable:opacity-0 group-hover/agent:pointer-events-auto group-hover/agent:opacity-100 group-has-[:focus-visible]/agent:pointer-events-auto group-has-[:focus-visible]/agent:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The new layout's sidebar as one tree: the pinned
 * Sessions of every Agent in a Pinned section at the top, then every Agent,
 * each opening to its own Sessions. The Agent that is open in the page opens
 * in the tree too; any other Agent opens and closes from its row.
 */
export function SidebarTree({ onNavigate }: { onNavigate?: () => void }) {
  const { agents, openAgentId, sessionOpen, unreadAgentIds } =
    useSidebarAgents();
  const activity = useActivitySessions();
  const pins = usePinnedSessions();
  const filters = useStore((s) => s.sidebarActivityFilters);
  const setFilters = useStore((s) => s.setSidebarActivityFilters);
  const allAgents = useAgentsList();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (openAgentId)
      setExpanded((prev) =>
        prev.has(openAgentId) ? prev : toggleExpanded(prev, openAgentId),
      );
  }, [openAgentId]);

  const pinned = useMemo(
    () =>
      splitPinned(filterActivitySessions(activity.items, filters), (item) =>
        pins.has(item.id),
      )[0],
    [activity.items, filters, pins],
  );
  const pinnedSessions = useMemo(
    () => pinned.map((item) => item.session),
    [pinned],
  );
  const conversationOf = useActivityConversations(pinnedSessions, allAgents);
  const shownAbove = new Set(pinned.map((item) => item.id));
  const orderActions = useSidebarOrderActions();
  const shownIds = agents.map((agent) => agent.id);
  const defaultAgent = useCreateDefaultAgent();

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pt-2 pb-3"
        data-testid="sidebar-tree"
      >
        {pinned.length > 0 && (
          <section aria-label="Pinned" className="mb-2">
            <ListLabel>Pinned</ListLabel>
            <div className="flex flex-col gap-px">
              {pinned.map((item) => (
                <PinnedRow
                  key={item.id}
                  item={item}
                  conversation={conversationOf(item.session)}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </section>
        )}
        <section aria-label="Agents">
          <ListLabel
            actions={
              <>
                <ActivityFilterMenu filters={filters} onChange={setFilters} />
                <CreateAgentMenu />
              </>
            }
          >
            Agents
          </ListLabel>
          {activity.unreadable && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              Recent sessions can't be loaded right now.
            </p>
          )}
          <ul className="flex flex-col gap-px">
            {agents.map((agent) => (
              <AgentNode
                key={agent.id}
                agent={agent}
                expanded={expanded.has(agent.id)}
                current={agent.id === openAgentId && !sessionOpen}
                unread={unreadAgentIds.has(agent.id)}
                shownAbove={shownAbove}
                onToggle={() =>
                  setExpanded((prev) => toggleExpanded(prev, agent.id))
                }
                order={orderActions}
                shownIds={shownIds}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
          <AddRow
            icon={AddAlt}
            label="New agent"
            testId="sidebar-new-agent-row"
            disabled={!defaultAgent.ready}
            onClick={() => void defaultAgent.create()}
          />
        </section>
      </div>
      <SettingsFooter onNavigate={onNavigate} />
    </div>
  );
}

function ListLabel({
  actions,
  children,
}: {
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-8 items-center justify-between gap-2 pr-1 pl-2">
      <SectionLabel>{children}</SectionLabel>
      {actions && <div className="flex items-center gap-0.5">{actions}</div>}
    </div>
  );
}

function AgentNode({
  agent,
  expanded,
  current,
  unread,
  shownAbove,
  onToggle,
  order,
  shownIds,
  onNavigate,
}: {
  agent: AgentView;
  expanded: boolean;
  current: boolean;
  unread: boolean;
  shownAbove: ReadonlySet<string>;
  onToggle: () => void;
  order: ReturnType<typeof useSidebarOrderActions>;
  shownIds: readonly string[];
  onNavigate?: () => void;
}) {
  const startSession = useStartSession();
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const setView = useStore((s) => s.setView);
  const confirmDelete = useConfirmDeleteAgent();
  const deleteAgent = useDeleteAgent();
  const mood = avatarMood(agent.state, agent);
  const drag = useOrderDrag({
    scope: "agents",
    id: agent.id,
    ready: order.ready,
    onMove: (id, drop) => order.moveAgent(shownIds, id, drop),
    onStep: (id, step) => order.stepAgent(shownIds, id, step),
  });
  const go = (fn: () => void) => () => {
    fn();
    onNavigate?.();
  };
  return (
    <li
      className={cn(expanded && "pb-3")}
      data-testid="sidebar-agent"
      data-agent-name={agent.name}
      data-expanded={expanded || undefined}
    >
      <div
        {...drag.dragProps}
        className={cn(
          "group/agent relative flex items-center rounded-lg transition-colors",
          current ? "bg-muted" : "hover:bg-muted",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-current={current ? "page" : undefined}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          data-testid="sidebar-agent-row"
          className={cn(
            "flex h-[34px] min-w-0 flex-1 items-center gap-2.5 rounded-lg pr-16 pl-2 text-left select-none",
            FOCUS_RING,
            mood !== "awake" && !expanded
              ? "text-muted-foreground hover:text-foreground"
              : "text-foreground",
          )}
        >
          <span className="relative flex size-5 shrink-0 items-center justify-center">
            <AgentAvatar
              name={agent.name}
              avatar={agent.avatar}
              size={20}
              mood={mood}
              className="group-has-[:focus-visible]/agent:invisible group-hover/agent:invisible"
            />
            <ChevronRight
              size={16}
              aria-hidden
              className={cn(
                "invisible absolute text-muted-foreground transition-transform group-has-[:focus-visible]/agent:visible group-hover/agent:visible motion-reduce:transition-none",
                expanded && "rotate-90",
              )}
            />
          </span>
          <span
            title={agent.name}
            className="min-w-0 flex-1 truncate text-sm font-medium"
          >
            {agent.name}
          </span>
          {unread && !expanded && (
            <>
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full bg-success group-has-[:focus-visible]/agent:hidden group-hover/agent:hidden"
              />
              <span className="sr-only">(unread)</span>
            </>
          )}
        </button>
        <div
          className={cn("absolute right-1 flex items-center gap-0.5", REVEAL)}
        >
          <Tooltip content="New session" side="bottom">
            <button
              type="button"
              aria-label={`New session with ${agent.name}`}
              data-testid="sidebar-agent-new-session"
              onClick={go(() => startSession(agent.id))}
              className={cn(
                "flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground",
                FOCUS_RING,
              )}
            >
              <AddComment size={16} />
            </button>
          </Tooltip>
          <RowActionsMenu
            label={`${agent.name} actions`}
            testId="sidebar-agent-menu"
            dense
          >
            <DropdownMenuItem
              onSelect={go(() => navigateToSandboxHome(agent.id))}
            >
              <Tools size={14} /> Configure
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
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
            </DropdownMenuItem>
          </RowActionsMenu>
        </div>
        <OrderDropIndicator at={drag.indicator} />
      </div>
      {expanded && (
        <div className="pt-px pl-2">
          <AgentSessionList
            agentId={agent.id}
            shownAbove={shownAbove}
            onNavigate={onNavigate}
          />
          <AddRow
            icon={AddComment}
            label="New session"
            testId="sidebar-new-session-row"
            onClick={go(() => startSession(agent.id))}
          />
        </div>
      )}
    </li>
  );
}

function PinnedRow({
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
  const { agentId, sessionId, mode } = item.session;
  const active = useStore(
    (s) =>
      s.view === "chat" &&
      s.selectedAgent === agentId &&
      s.sessionId === sessionId,
  );
  const approvals = useApprovalsForOwner().data;
  const permissionPending = useStore((s) =>
    s.pendingPermissions.some((p) => p.sessionId === sessionId),
  );
  const actWhenAwake = useActWhenAwake(agentId);
  const session = provisionalSessionView(item.session);
  const label = session.title || sessionId.slice(0, 12);
  const state = {
    working: item.working,
    needsApproval:
      permissionPending || awaitsApproval(approvals ?? [], agentId, sessionId),
    unread: item.unread,
  };
  return (
    <>
      <SessionRow
        session={session}
        active={active}
        {...state}
        leading={<ActivityDot tone={activityTone(state)} />}
        indicators={false}
        conversation={`${item.agent.name} · ${sessionContext(session, conversation)}`}
        className={ROW}
        pinned
        onTogglePin={() => togglePinnedSession(item.id)}
        onResume={() => {
          openSession(agentId, sessionId, mode);
          onNavigate?.();
        }}
        onRename={() =>
          actWhenAwake(`rename:${sessionId}`, () => setRenaming(true))
        }
        onDelete={() =>
          void showConfirm(
            "Its transcript is deleted and cannot be recovered.",
            `Delete session “${label}”?`,
            { kind: "destructive", confirmLabel: "Delete session" },
          ).then(
            (ok) =>
              ok &&
              actWhenAwake(`delete:${sessionId}`, async () => {
                if (!(await deleteSession(sessionId, agentId))) return;
                unpinSession(item.id);
              }),
          )
        }
      />
      {renaming && (
        <RenameSessionDialog
          agentId={agentId}
          session={session}
          onClose={() => setRenaming(false)}
        />
      )}
    </>
  );
}

function CreateAgentMenu() {
  const defaultAgent = useCreateDefaultAgent();
  const setKitBrowserOpen = useStore((s) => s.setKitBrowserOpen);
  return (
    <DropdownMenu>
      <Tooltip content="Create agent" side="bottom">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Create agent"
            data-testid="sidebar-create-agent"
            className={cn(
              "flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground",
              FOCUS_RING,
            )}
          >
            <AddAlt size={16} />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={!defaultAgent.ready}
          onSelect={() => void defaultAgent.create()}
        >
          <AddAlt size={14} /> New agent
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setKitBrowserOpen(true)}>
          <DataEnrichmentAdd size={14} /> Use a starter kit
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SettingsFooter({ onNavigate }: { onNavigate?: () => void }) {
  const settingsOpen = useStore((s) => s.view === "settings");
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  return (
    <div className="shrink-0 border-t border-border p-2">
      <button
        type="button"
        aria-current={settingsOpen ? "page" : undefined}
        onClick={() => {
          navigateToSettings();
          onNavigate?.();
        }}
        className={cn(
          "flex h-[34px] w-full items-center gap-2.5 rounded-lg px-2 text-sm font-medium transition-colors",
          FOCUS_RING,
          settingsOpen
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <Settings size={16} /> Settings
      </button>
    </div>
  );
}
