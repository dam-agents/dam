import {
  Add,
  Bot,
  Chat,
  Gift,
  Home,
  Settings,
  Tools,
  TrashCan,
} from "@carbon/icons-react";

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
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useStore } from "../../../../store.js";
import type { AgentView } from "../../../../types.js";
import { useDeleteAgent } from "../../../agents/api/mutations.js";
import {
  AgentAvatar,
  avatarMood,
} from "../../../agents/components/avatar/agent-avatar.js";
import { OrderDropIndicator } from "../../../agents/components/order-drop-indicator.js";
import { useConfirmDeleteAgent } from "../../../agents/hooks/use-confirm-delete-agent.js";
import { useCreateDefaultAgent } from "../../../agents/hooks/use-create-default-agent.js";
import { useOrderDrag } from "../../../agents/hooks/use-order-drag.js";
import { useSidebarOrderActions } from "../../../agents/hooks/use-sidebar-order-actions.js";
import { useUpdateSandbox } from "../../../agents/hooks/use-update-sandbox.js";
import { useStartSession } from "../../../sessions/hooks/use-start-session.js";
import { stripWidth } from "../../lib/agent-strip.js";
import { AgentStripCard } from "./agent-strip-card.js";

const WIDE_ROW = "w-full justify-start gap-2.5 px-2.5";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The sidebar's agent strip in one of its two
 * widths. Narrow, each agent is an avatar tile. Wide, each agent is a card
 * with its name, whether it is working, its pending update and its actions.
 */
export function AvatarStrip({
  agents,
  selected,
  current,
  needsYou,
  workingIds,
  onSelect,
  onNavigate,
}: {
  agents: readonly AgentView[];
  selected: string | null;
  current: string | null;
  needsYou: ReadonlyMap<string, number>;
  workingIds: ReadonlySet<string>;
  onSelect: (agentId: string | null) => void;
  onNavigate?: () => void;
}) {
  const wide = useStore((s) => s.sidebarStripWide);
  const defaultAgent = useCreateDefaultAgent();
  const setKitBrowserOpen = useStore((s) => s.setKitBrowserOpen);
  const orderActions = useSidebarOrderActions();
  const update = useUpdateSandbox();
  const shownIds = agents.map((agent) => agent.id);
  const settingsOpen = useStore((s) => s.view === "settings");
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const total = [...needsYou.values()].reduce((a, b) => a + b, 0);
  return (
    <div
      className="flex shrink-0 flex-col border-r border-border"
      style={{ width: stripWidth(wide) }}
      data-wide={wide || undefined}
    >
      <nav
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto pt-3 pb-4 [scrollbar-width:none]",
          wide ? "items-stretch px-2.5" : "items-center",
        )}
        aria-label="Agents"
        data-testid="sidebar-avatar-strip"
      >
        <StripButton
          label="Home"
          wide={wide}
          active={!settingsOpen && selected === null}
          badge={total}
          onClick={() => onSelect(null)}
        >
          <Home size={18} />
        </StripButton>
        <span
          aria-hidden
          className={cn("h-px shrink-0 bg-border", wide ? "mx-1" : "w-6")}
        />
        {agents.map((agent) => (
          <DraggableAgent
            key={agent.id}
            agent={agent}
            wide={wide}
            shown={shownIds}
            orderActions={orderActions}
            active={!settingsOpen && selected === agent.id}
            current={current === agent.id}
            badge={needsYou.get(agent.id) ?? 0}
            working={workingIds.has(agent.id)}
            updating={update.updatingId === agent.id}
            updateBusy={update.updatingId !== null}
            onUpdate={() => void update.updateOne(agent)}
            onSelect={() => onSelect(agent.id)}
            onNavigate={onNavigate}
          />
        ))}
        <DropdownMenu>
          <StripTooltip label="Create agent" wide={wide}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Create agent"
                data-testid="sidebar-create-agent"
                className={cn(
                  "flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm text-muted-foreground transition-colors hover:border-border-ui hover:text-foreground data-[state=open]:border-border-ui data-[state=open]:text-foreground",
                  wide ? "w-full" : "w-10",
                )}
              >
                <Add size={wide ? 16 : 20} />
                {wide && "Create agent"}
              </button>
            </DropdownMenuTrigger>
          </StripTooltip>
          <DropdownMenuContent side="right" align="end" sideOffset={8}>
            <DropdownMenuItem
              disabled={!defaultAgent.ready}
              onSelect={() => void defaultAgent.create()}
            >
              <Bot size={14} /> New agent
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setKitBrowserOpen(true)}>
              <Gift size={14} /> Use a starter kit
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
      <div
        className={cn(
          "relative z-raised flex shrink-0 flex-col justify-center gap-1 bg-chrome py-2",
          wide ? "items-stretch px-2.5" : "items-center",
        )}
      >
        <StripTooltip label="Settings" wide={wide}>
          <button
            type="button"
            aria-label="Settings"
            aria-current={settingsOpen ? "page" : undefined}
            onClick={() => {
              navigateToSettings();
              onNavigate?.();
            }}
            className={cn(railTile(settingsOpen), wide && WIDE_ROW)}
          >
            <span aria-hidden className={railIndicator("left", settingsOpen)} />
            <Settings size={18} />
            {wide && <span className="text-sm font-medium">Settings</span>}
          </button>
        </StripTooltip>
      </div>
    </div>
  );
}

function DraggableAgent({
  agent,
  wide,
  shown,
  orderActions,
  active,
  current,
  badge,
  working,
  updating,
  updateBusy,
  onUpdate,
  onSelect,
  onNavigate,
}: {
  agent: AgentView;
  wide: boolean;
  shown: readonly string[];
  orderActions: ReturnType<typeof useSidebarOrderActions>;
  active: boolean;
  current: boolean;
  badge: number;
  working: boolean;
  updating: boolean;
  updateBusy: boolean;
  onUpdate: () => void;
  onSelect: () => void;
  onNavigate?: () => void;
}) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const setView = useStore((s) => s.setView);
  const startSession = useStartSession();
  const confirmDelete = useConfirmDeleteAgent();
  const deleteAgent = useDeleteAgent();
  const drag = useOrderDrag({
    scope: "agents",
    id: agent.id,
    ready: orderActions.ready,
    onMove: (id, drop) => orderActions.moveAgent(shown, id, drop),
    onStep: (id, step) => orderActions.stepAgent(shown, id, step),
  });
  const configure = () => {
    navigateToSandboxHome(agent.id);
    onNavigate?.();
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          {...drag.dragProps}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          data-testid="sidebar-strip-agent"
          className="relative"
        >
          {wide ? (
            <AgentStripCard
              agent={agent}
              active={active}
              current={current}
              badge={badge}
              working={working}
              updating={updating}
              updateBusy={updateBusy}
              onSelect={onSelect}
              onUpdate={onUpdate}
              onNewSession={() => {
                startSession(agent.id);
                onNavigate?.();
              }}
              onConfigure={configure}
            />
          ) : (
            <StripButton
              label={agent.name}
              wide={false}
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
          )}
          <OrderDropIndicator at={drag.indicator} />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onSelect}>
          <Chat size={14} /> Chat
        </ContextMenuItem>
        <ContextMenuItem onSelect={configure}>
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
  wide,
  active,
  current = false,
  badge,
  onClick,
  children,
}: {
  label: string;
  wide: boolean;
  active: boolean;
  current?: boolean;
  badge: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <StripTooltip label={label} wide={wide}>
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        aria-label={badge > 0 ? `${label}, ${badge} need you` : label}
        onClick={onClick}
        className={cn(railTile(active), wide && WIDE_ROW)}
      >
        <span aria-hidden className={railIndicator("left", active, current)} />
        {children}
        {wide && <span className="text-sm font-medium">{label}</span>}
        {badge > 0 && (
          <span
            className={cn(RAIL_BADGE, "bg-warning", wide && "static ml-auto")}
          >
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </button>
    </StripTooltip>
  );
}

function StripTooltip({
  label,
  wide,
  children,
}: {
  label: string;
  wide: boolean;
  children: React.ReactNode;
}) {
  if (wide) return children;
  return (
    <Tooltip content={label} side="right">
      {children}
    </Tooltip>
  );
}
