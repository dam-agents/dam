import { ChevronLeft, Home, Settings } from "@carbon/icons-react";

import { ResizeHandle } from "@/components/resize-handle";
import { cn } from "@/lib/utils";

import { useStore } from "../../../../store.js";
import { useAgentsList } from "../../../agents/api/queries.js";
import {
  AgentAvatar,
  avatarMood,
} from "../../../agents/components/avatar/agent-avatar.js";
import { useActivitySessions } from "../../../home/hooks/use-activity-sessions.js";
import { useSidebarWidth } from "../../hooks/use-sidebar-layout.js";
import { SidebarContent } from "./sidebar-content.js";
import { SidebarHeader } from "./sidebar-header.js";

const SLIDE =
  "transition-[translate] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The desktop navigation pane. Pinned, it holds its
 * place beside the page and can be resized. Unpinned, it leaves the layout and
 * slides over the page when the pointer reaches the left edge or the floating
 * button is pressed, which is the only way in on a touch screen.
 */
export function Sidebar() {
  const pinned = useStore((s) => s.sidebarExpanded);
  const setPinned = useStore((s) => s.setSidebarExpanded);
  const setView = useStore((s) => s.setView);
  const { width, resize, endResize } = useSidebarWidth();
  const peek = useStore((s) => s.sidebarPeek);
  const setPeek = useStore((s) => s.setSidebarPeek);
  const shown = pinned || peek;

  return (
    <>
      {!pinned && (
        <div
          aria-hidden
          className="fixed inset-y-0 left-0 z-nav hidden w-2 md:block"
          onMouseEnter={() => setPeek(true)}
        />
      )}
      {peek && !pinned && (
        <div
          aria-hidden
          className="fixed inset-0 z-nav hidden md:block"
          onClick={() => setPeek(false)}
        />
      )}
      <nav
        className={cn(
          "hidden md:flex relative flex-col h-full shrink-0 bg-card border-r border-border",
          !pinned && ["fixed inset-y-0 left-0 z-overlay", SLIDE],
          !pinned && shown && "shadow-[4px_0_16px_-4px_rgb(0_0_0/0.18)] dark:shadow-[6px_0_20px_-4px_rgb(0_0_0/0.6)]",
          !shown && "-translate-x-full",
        )}
        style={{ width }}
        inert={!shown}
        onMouseLeave={(e) => {
          if (e.clientX > e.currentTarget.getBoundingClientRect().right)
            setPeek(false);
        }}
        data-testid="app-sidebar"
        data-pinned={pinned || undefined}
      >
        <SidebarHeader
          pinned={pinned}
          onTogglePin={() => {
            setPinned(!pinned);
            setPeek(false);
          }}
          onHome={() => setView("home")}
        />
        <SidebarContent />
      </nav>
      {pinned && (
        <div className="hidden md:flex" data-testid="app-sidebar-resize">
          <ResizeHandle side="left" onResize={resize} onDragEnd={endResize} />
        </div>
      )}
      {!shown && <PeekButton onOpen={() => setPeek(true)} />}
    </>
  );
}

function PeekButton({ onOpen }: { onOpen: () => void }) {
  const hasUnread = useActivitySessions().items.some((item) => item.unread);
  const view = useStore((s) => s.view);
  const openAgentId = useStore((s) =>
    s.view === "chat"
      ? s.selectedAgent
      : s.view === "sandbox-home"
        ? s.agentId
        : null,
  );
  const agent = useAgentsList().find((a) => a.id === openAgentId);
  return (
    <button
      type="button"
      aria-label="Show navigation"
      onClick={onOpen}
      data-testid="sidebar-peek-button"
      className="fixed top-3 left-3 z-nav hidden h-10 items-center gap-1.5 rounded-full border border-border bg-card pr-3.5 pl-2 text-foreground/80 shadow-lg transition-colors anim-in hover:bg-muted hover:text-foreground md:flex"
    >
      <ChevronLeft size={16} className="text-muted-foreground" />
      {agent ? (
        <AgentAvatar
          name={agent.name}
          avatar={agent.avatar}
          size={22}
          mood={avatarMood(agent.state, agent)}
        />
      ) : view === "settings" ? (
        <Settings size={18} />
      ) : (
        <Home size={18} />
      )}
      <span className="ml-0.5 max-w-48 truncate text-sm font-medium text-foreground">
        {agent ? agent.name : view === "settings" ? "Settings" : "Home"}
      </span>
      {hasUnread && (
        <span className="absolute top-1 right-1 size-2 rounded-full bg-warning ring-2 ring-card" />
      )}
    </button>
  );
}
