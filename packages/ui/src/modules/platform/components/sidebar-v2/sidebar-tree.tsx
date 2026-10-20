import {
  Add,
  type CarbonIconType,
  ChevronRight,
  DataEnrichmentAdd,
  Home,
  Settings,
  Tools,
  TrashCan,
} from "@carbon/icons-react";
import { useQueries } from "@tanstack/react-query";
import { type ReactNode, useId, useMemo, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FOCUS_RING } from "@/components/ui/focus-ring";
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
import { useConfirmDeleteAgent } from "../../../agents/hooks/use-confirm-delete-agent.js";
import { useCreateDefaultAgent } from "../../../agents/hooks/use-create-default-agent.js";
import { useOrderDrag } from "../../../agents/hooks/use-order-drag.js";
import { useSidebarAgents } from "../../../agents/hooks/use-sidebar-agents.js";
import { useSidebarOrderActions } from "../../../agents/hooks/use-sidebar-order-actions.js";
import { useApprovalsForOwner } from "../../../approvals/api/queries.js";
import { ActivityFilterMenu } from "../../../home/components/activity-filter-menu.js";
import { useActivityConversations } from "../../../home/hooks/use-activity-conversations.js";
import { useActivitySessions } from "../../../home/hooks/use-activity-sessions.js";
import { filterActivitySessions } from "../../../home/lib/activity-sessions.js";
import { useStartSession } from "../../../sessions/hooks/use-start-session.js";
import { usePinnedSessions } from "../../../sessions/lib/pinned-sessions.js";
import { newestFirst } from "../../../sessions/lib/sidebar-session-window.js";
import {
  awaitsApproval,
  isExpanded,
  offFeedPins,
  pinActivityQuery,
  splitPinned,
  toggleExpanded,
} from "../../lib/sidebar-tree.js";
import { AgentCue } from "./activity-dot.js";
import { AddRow, TREE_LEADING } from "./add-row.js";
import { AgentSessionList } from "./agent-session-list.js";
import { FeedPinnedRow, OffFeedPinnedRow } from "./pinned-rows.js";

const REVEAL =
  "transition-opacity hover-capable:pointer-events-none hover-capable:opacity-0 group-hover/agent:pointer-events-auto group-hover/agent:opacity-100 group-has-[:focus-visible]/agent:pointer-events-auto group-has-[:focus-visible]/agent:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The new layout's sidebar as one tree: the pinned
 * Sessions of every Agent in a Pinned section at the top, then every Agent,
 * each opening to its own Sessions. The Agent that is open in the page opens
 * in the tree too until its row closes it; any other Agent opens and closes
 * from its row. An Agent's attention hint refreshes that Agent's own list,
 * so an open list stays live without its chat.
 */
export function SidebarTree({ onNavigate }: { onNavigate?: () => void }) {
  const { agents, openAgentId, sessionOpen, unreadAgentIds } =
    useSidebarAgents();
  const activity = useActivitySessions();
  const pins = usePinnedSessions();
  const filters = useStore((s) => s.sidebarActivityFilters);
  const setFilters = useStore((s) => s.setSidebarActivityFilters);
  const allAgents = useAgentsList();
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(
    new Map(),
  );
  const approvals = useApprovalsForOwner().data;

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
  const inFeed = useMemo(
    () => new Set(activity.items.map((item) => item.id)),
    [activity.items],
  );
  const offFeed = offFeedPins(
    pins,
    inFeed,
    agents.map((agent) => agent.id),
  ).flatMap(({ agentId, sessionId }) =>
    agents
      .filter((agent) => agent.id === agentId)
      .map((agent) => ({ agent, sessionId })),
  );
  const offFeedAt = useQueries({
    queries: offFeed.map(({ agent, sessionId }) =>
      pinActivityQuery(agent.id, sessionId),
    ),
  });
  const pinRows = newestFirst(
    [
      ...pinned.map((item) => ({ key: item.id, at: item.at, item })),
      ...offFeed.map((pin, i) => ({
        key: `${pin.agent.id}:${pin.sessionId}`,
        at: offFeedAt[i]?.data,
        pin,
      })),
    ],
    (row) => row.at,
    (row) => row.key,
  );
  const orderActions = useSidebarOrderActions();
  const shownIds = agents.map((agent) => agent.id);
  const defaultAgent = useCreateDefaultAgent();
  const homeOpen = useStore((s) => s.view === "home");
  const setView = useStore((s) => s.setView);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pt-2 pb-3"
        data-testid="sidebar-tree"
      >
        <div className="mb-2">
          <NavRow
            icon={Home}
            label="Home"
            current={homeOpen}
            testId="sidebar-home-row"
            onClick={() => {
              setView("home");
              onNavigate?.();
            }}
          />
        </div>
        {(pinned.length > 0 || offFeed.length > 0) && (
          <section
            aria-label="Pinned"
            className="mb-2 hidden has-[[data-pin-key]]:block"
          >
            <ListLabel>Pinned</ListLabel>
            <div className="flex flex-col gap-px">
              {pinRows.map((row) =>
                "item" in row ? (
                  <FeedPinnedRow
                    key={row.key}
                    item={row.item}
                    conversation={conversationOf(row.item.session)}
                    onNavigate={onNavigate}
                  />
                ) : (
                  <OffFeedPinnedRow
                    key={row.key}
                    agent={row.pin.agent}
                    sessionId={row.pin.sessionId}
                    onNavigate={onNavigate}
                  />
                ),
              )}
            </div>
          </section>
        )}
        <section aria-label="Agents">
          <ListLabel
            actions={
              <>
                <ActivityFilterMenu filters={filters} onChange={setFilters} />
                <CreateAgentMenu defaultAgent={defaultAgent} />
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
                expanded={isExpanded(toggled, agent.id, openAgentId)}
                current={agent.id === openAgentId && !sessionOpen}
                cue={
                  awaitsApproval(approvals ?? [], agent.id)
                    ? "approval"
                    : unreadAgentIds.has(agent.id)
                      ? "unread"
                      : null
                }
                onToggle={() =>
                  setToggled((prev) =>
                    toggleExpanded(prev, agent.id, openAgentId),
                  )
                }
                order={orderActions}
                shownIds={shownIds}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
          <AddRow
            icon={Add}
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
  cue,
  onToggle,
  order,
  shownIds,
  onNavigate,
}: {
  agent: AgentView;
  expanded: boolean;
  current: boolean;
  cue: "approval" | "unread" | null;
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
  const listId = useId();
  return (
    <li
      className={cn(expanded && "pb-3")}
      data-testid="sidebar-agent"
      data-agent-id={agent.id}
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
          aria-controls={expanded ? listId : undefined}
          aria-current={current ? "page" : undefined}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          data-testid="sidebar-agent-row"
          className={cn(
            "flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-lg pr-16 pl-2 text-left select-none",
            FOCUS_RING,
            mood !== "awake" && !expanded
              ? "text-muted-foreground hover:text-foreground"
              : "text-foreground",
          )}
        >
          <span className={cn(TREE_LEADING, "relative h-6 items-center")}>
            <AgentAvatar
              name={agent.name}
              avatar={agent.avatar}
              size={24}
              mood={mood}
              className="group-has-[:focus-visible]/agent:invisible group-hover/agent:invisible [@media(hover:none)]:invisible"
            />
            <ChevronRight
              size={16}
              aria-hidden
              className={cn(
                "invisible absolute text-muted-foreground transition-transform group-has-[:focus-visible]/agent:visible group-hover/agent:visible motion-reduce:transition-none [@media(hover:none)]:visible",
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
          {cue && !expanded && <AgentCue tone={cue} />}
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
              <Add size={16} />
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
        <div className="pt-px" id={listId}>
          <AgentSessionList agentId={agent.id} onNavigate={onNavigate} />
          <AddRow
            icon={Add}
            label="New session"
            ariaLabel={`New session with ${agent.name}`}
            testId="sidebar-new-session-row"
            onClick={go(() => startSession(agent.id))}
          />
        </div>
      )}
    </li>
  );
}

function CreateAgentMenu({
  defaultAgent,
}: {
  defaultAgent: ReturnType<typeof useCreateDefaultAgent>;
}) {
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
            <Add size={16} />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={!defaultAgent.ready}
          onSelect={() => void defaultAgent.create()}
        >
          <Add size={14} /> New agent
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
      <NavRow
        icon={Settings}
        label="Settings"
        current={settingsOpen}
        onClick={() => {
          navigateToSettings();
          onNavigate?.();
        }}
      />
    </div>
  );
}

function NavRow({
  icon: Icon,
  label,
  current,
  testId,
  onClick,
}: {
  icon: CarbonIconType;
  label: string;
  current: boolean;
  testId?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={current ? "page" : undefined}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "flex h-[34px] w-full items-center gap-2.5 rounded-lg px-2 text-sm font-medium transition-colors",
        FOCUS_RING,
        current
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <span className={TREE_LEADING}>
        <Icon size={16} />
      </span>
      {label}
    </button>
  );
}
