import { Add, ChevronRight, Home, Pin, Settings } from "@carbon/icons-react";
import {
  type FocusEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { FOCUS_RING } from "@/components/ui/focus-ring";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover.js";
import {
  RAIL_AVATAR,
  RAIL_COLUMN,
  RAIL_GAP,
  RAIL_GLYPH,
  RAIL_SEPARATOR,
  railTile,
} from "@/components/ui/rail-tile";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useStore } from "../../../../store.js";
import type { AgentView } from "../../../../types.js";
import {
  AgentAvatar,
  avatarMood,
} from "../../../agents/components/avatar/agent-avatar.js";
import { useSidebarAgents } from "../../../agents/hooks/use-sidebar-agents.js";
import { useApprovalsForOwner } from "../../../approvals/api/queries.js";
import { useStartSession } from "../../../sessions/hooks/use-start-session.js";
import { usePinnedSessions } from "../../../sessions/lib/pinned-sessions.js";
import { awaitsApproval } from "../../lib/sidebar-tree.js";
import { AddRow } from "./add-row.js";
import { AgentContextMenu, AgentRowActions } from "./agent-row-actions.js";
import { AgentSessionList } from "./agent-session-list.js";
import { PinnedList } from "./pinned-rows.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: JanUI's sidebar as one column of icons, which it becomes when it is collapsed: Home, the Pinned section, one avatar per Agent in the same manual order and Settings. An avatar opens that Agent's new-session page when clicked, and what the expanded tree would show under it, in a popover beside the rail, on hover or keyboard focus, or on a long press where there is no hover; choosing a Session closes the popover; the pin icon opens the Pinned section on click. The rail never leaves the layout, so the page always has a way back to the tree.
 */
export function SidebarRail({
  onExpand,
  onNavigate,
}: {
  onExpand: () => void;
  onNavigate?: () => void;
}) {
  const { agents, openAgentId, unreadAgentIds } = useSidebarAgents();
  const approvals = useApprovalsForOwner().data;
  const pins = usePinnedSessions();
  const homeOpen = useStore((s) => s.view === "home");
  const settingsOpen = useStore((s) => s.view === "settings");
  const setView = useStore((s) => s.setView);
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const [open, setOpen] = useState<string | null>(null);
  const close = () => setOpen(null);
  const navigate = () => {
    close();
    onNavigate?.();
  };

  return (
    <div
      className={cn(
        "min-h-0 flex-1 overflow-x-visible overflow-y-auto",
        RAIL_COLUMN,
      )}
      data-testid="sidebar-rail"
    >
      <Tooltip content="Expand navigation" side="right">
        <button
          type="button"
          onClick={onExpand}
          aria-label="Expand navigation"
          data-testid="sidebar-rail-expand"
          className={cn(railTile(false), FOCUS_RING)}
        >
          <ChevronRight size={RAIL_GLYPH} />
        </button>
      </Tooltip>
      <Tooltip content="Home" side="right">
        <button
          type="button"
          onClick={() => {
            setView("home");
            navigate();
          }}
          aria-label="Home"
          aria-current={homeOpen ? "page" : undefined}
          data-testid="sidebar-home-row"
          className={cn(railTile(homeOpen), FOCUS_RING)}
        >
          <Home size={RAIL_GLYPH} />
        </button>
      </Tooltip>
      {pins.size > 0 && (
        <PinnedTile
          open={open === "pinned"}
          onOpenChange={(next) =>
            setOpen((prev) =>
              next ? "pinned" : prev === "pinned" ? null : prev,
            )
          }
          onNavigate={navigate}
        />
      )}
      <div
        className={cn("relative flex min-h-0 flex-col items-center", RAIL_GAP)}
        data-testid="sidebar-rail-agents"
      >
        <div aria-hidden className={cn(RAIL_SEPARATOR, "-top-[3px]")}>
          <span className="h-px w-6 bg-border" />
        </div>
        {agents.map((agent) => (
          <AgentTile
            key={agent.id}
            agent={agent}
            current={agent.id === openAgentId}
            cue={
              awaitsApproval(approvals ?? [], agent.id)
                ? "approval"
                : unreadAgentIds.has(agent.id)
                  ? "unread"
                  : null
            }
            open={open === agent.id}
            onOpenChange={(next) =>
              setOpen((prev) =>
                next ? agent.id : prev === agent.id ? null : prev,
              )
            }
            onNavigate={navigate}
          />
        ))}
      </div>
      <Tooltip content="Settings" side="right">
        <button
          type="button"
          onClick={() => {
            navigateToSettings();
            navigate();
          }}
          aria-label="Settings"
          aria-current={settingsOpen ? "page" : undefined}
          data-testid="sidebar-settings-row"
          className={cn(railTile(settingsOpen), "mt-auto", FOCUS_RING)}
        >
          <Settings size={RAIL_GLYPH} />
        </button>
      </Tooltip>
    </div>
  );
}

const HOVER_OPEN_MS = 150;
const HOVER_CLOSE_MS = 250;

/**
 * UNIT_BOUNDARY_DESCRIPTION: What a tile of the rail needs to open what it holds in a popover beside it: the pointer resting on the tile opens it after a moment, leaving the tile and the popover closes it after a grace long enough to move between them, keyboard focus opens it, and a menu opened from the popover keeps it alive.
 */
function useRailPopover(onOpenChange: (open: boolean) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closedAt = useRef(0);
  const content = useRef<HTMLDivElement>(null);
  const hovering = useRef(false);
  const cancel = () => clearTimeout(timer.current);
  const closeSoon = () => {
    cancel();
    timer.current = setTimeout(() => {
      // UNIT_BOUNDARY_DESCRIPTION: a menu opened from the popover outlives the pointer leaving it.
      if (content.current?.querySelector('[data-state="open"]')) return;
      closedAt.current = Date.now();
      onOpenChange(false);
    }, HOVER_CLOSE_MS);
  };
  const openSoon = () => {
    cancel();
    timer.current = setTimeout(() => onOpenChange(true), HOVER_OPEN_MS);
  };
  useEffect(() => cancel, []);
  return {
    hovered: () => hovering.current,
    // UNIT_BOUNDARY_DESCRIPTION: a press dismisses the popover, and a pointer still resting on the tile takes it back.
    keepOpen: () => {
      if (hovering.current) onOpenChange(true);
    },
    dismissed: () => {
      closedAt.current = Date.now();
    },
    trigger: {
      onPointerEnter: (e: PointerEvent<HTMLButtonElement>) => {
        if (e.pointerType === "touch") return;
        hovering.current = true;
        openSoon();
      },
      onPointerLeave: (e: PointerEvent<HTMLButtonElement>) => {
        cancel();
        if (e.pointerType === "touch") return;
        hovering.current = false;
        closeSoon();
      },
      onFocus: (e: FocusEvent<HTMLButtonElement>) => {
        // UNIT_BOUNDARY_DESCRIPTION: Escape returns focus to this tile, and must not reopen what it closed.
        if (
          e.currentTarget.matches(":focus-visible") &&
          Date.now() - closedAt.current > HOVER_CLOSE_MS
        ) {
          cancel();
          onOpenChange(true);
        }
      },
    },
    content: {
      ref: content,
      onPointerEnter: cancel,
      onPointerLeave: closeSoon,
    },
  };
}

function AgentTile({
  agent,
  current,
  cue,
  open,
  onOpenChange,
  onNavigate,
}: {
  agent: AgentView;
  current: boolean;
  cue: "approval" | "unread" | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: () => void;
}) {
  const startSession = useStartSession();
  const name = `New session with ${agent.name}${
    cue ? `, ${cue === "approval" ? "needs your approval" : "unread"}` : ""
  }`;
  const rail = useRailPopover(onOpenChange);
  const newSession = () => {
    onNavigate();
    startSession(agent.id);
    rail.keepOpen();
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <AgentContextMenu agent={agent} current={current} onNavigate={onNavigate}>
        <PopoverAnchor asChild>
          <button
            type="button"
            aria-label={name}
            aria-current={current ? "page" : undefined}
            data-testid="sidebar-rail-agent"
            data-agent-id={agent.id}
            className={cn(railTile(current || open), FOCUS_RING)}
            onClick={newSession}
            {...rail.trigger}
          >
            <AgentAvatar
              name={agent.name}
              avatar={agent.avatar}
              size={RAIL_AVATAR}
              mood={avatarMood(agent.state, agent)}
            />
            {cue && (
              <span
                aria-hidden
                className={cn(
                  "absolute top-0.5 right-0.5 size-2 rounded-full ring-2 ring-chrome",
                  cue === "approval" ? "bg-warning" : "bg-success",
                )}
              />
            )}
          </button>
        </PopoverAnchor>
      </AgentContextMenu>
      <PopoverContent
        side="right"
        align="start"
        className="max-h-[70vh] w-[320px] overflow-y-auto p-2"
        {...rail.content}
      >
        <div className="flex h-8 items-center justify-between gap-2 pr-1 pl-2">
          <span className="truncate text-sm font-medium">{agent.name}</span>
          <AgentRowActions
            agent={agent}
            current={current}
            onNavigate={onNavigate}
            revealedOnHover={false}
          />
        </div>
        <AgentSessionList
          agentId={agent.id}
          onNavigate={onNavigate}
          newSessionRow={
            <AddRow
              icon={Add}
              label="New session"
              ariaLabel={`New session with ${agent.name}`}
              testId="sidebar-new-session-row"
              onClick={() => {
                onNavigate();
                startSession(agent.id);
              }}
            />
          }
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The rail's Pinned tile, which has no page behind it: a click does nothing but open the popover, and a pointer resting on the tile or keyboard focus opens it as it does for an Agent's tile, listing the Pinned Sessions.
 */
function PinnedTile({
  open,
  onOpenChange,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: () => void;
}) {
  const rail = useRailPopover(onOpenChange);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <button
          type="button"
          aria-label="Pinned sessions"
          aria-current={open ? "page" : undefined}
          data-testid="sidebar-rail-pinned"
          className={cn(railTile(open), FOCUS_RING)}
          onClick={() => {
            if (rail.hovered()) rail.keepOpen();
            else onOpenChange(!open);
          }}
          {...rail.trigger}
        >
          <Pin size={RAIL_GLYPH} />
        </button>
      </PopoverAnchor>
      <PopoverContent
        side="right"
        align="start"
        className="max-h-[70vh] w-[320px] overflow-y-auto p-2"
        {...rail.content}
      >
        <div className="px-2 pb-1 text-xs font-semibold text-muted-foreground">
          Pinned
        </div>
        <div className="flex flex-col gap-px">
          <PinnedList onNavigate={onNavigate} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
