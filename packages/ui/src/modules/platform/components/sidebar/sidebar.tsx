import { OpenPanelLeft } from "@carbon/icons-react";
import { useState } from "react";

import { ResizeHandle } from "@/components/resize-handle";
import { PANE_MOTION } from "@/lib/pane-motion";
import { cn } from "@/lib/utils";

import { useStore } from "../../../../store.js";
import { HomeWidgets } from "../../../home/components/home-widgets.js";
import { useActivitySessions } from "../../../home/hooks/use-activity-sessions.js";
import { useSidebarDestinations } from "../../hooks/use-sidebar-destinations.js";
import { useSidebarWidth } from "../../hooks/use-sidebar-layout.js";
import { SidebarContent } from "./sidebar-content.js";
import { SidebarHeader } from "./sidebar-header.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The navigation pane, which is also Home. On Home
 * it fills the width beside the side panel. Elsewhere it is the sidebar:
 * pinned, it holds its place in the layout; unpinned, it leaves the layout and
 * slides over the page when the pointer reaches the left edge or the floating
 * button is pressed, which is the only way in on a touch screen.
 */
export function Sidebar({ home = false }: { home?: boolean }) {
  const pinned = useStore((s) => s.sidebarExpanded);
  const setPinned = useStore((s) => s.setSidebarExpanded);
  const destinations = useSidebarDestinations();
  const { width, resizing, resize, endResize } = useSidebarWidth();
  const [peek, setPeek] = useState(false);
  const docked = home || pinned;
  const shown = docked || peek;

  return (
    <>
      <div
        className={cn(
          "relative hidden md:flex min-w-0",
          !resizing && PANE_MOTION,
        )}
        style={{ flex: `${home ? 1 : 0} 0 ${docked ? width : 0}px` }}
      >
        {!docked && (
          <div
            aria-hidden
            className="absolute inset-y-0 left-0 z-nav w-2"
            onMouseEnter={() => setPeek(true)}
          />
        )}
        <nav
          className={cn(
            "flex flex-col h-full overflow-hidden px-2 bg-card border-border",
            !home && "border-r",
            docked
              ? "relative w-full"
              : "absolute inset-y-0 left-0 z-overlay shadow-2xl",
            !resizing && PANE_MOTION,
            !shown && "-translate-x-full",
          )}
          style={docked ? undefined : { width }}
          onMouseLeave={(e) => {
            if (e.clientX > e.currentTarget.getBoundingClientRect().right)
              setPeek(false);
          }}
          inert={!shown}
          data-testid="app-sidebar"
          data-home={home || undefined}
          data-pinned={pinned || undefined}
        >
          <div
            className={cn(
              "mx-auto flex min-h-0 w-full flex-1 flex-col",
              PANE_MOTION,
              home ? "max-w-[960px] px-4 pt-6 lg:px-[5%]" : "max-w-full",
            )}
          >
            <SidebarHeader
              pinned={pinned}
              onTogglePin={
                home
                  ? undefined
                  : () => {
                      setPinned(!pinned);
                      setPeek(false);
                    }
              }
              onHome={destinations.home.navigate}
            />
            <SidebarContent
              stickyHeaderClassName="bg-card"
              onNavigate={() => setPeek(false)}
              lead={<HomeWidgets open={home} />}
            />
          </div>
        </nav>
      </div>
      {pinned && !home && (
        <div className="hidden md:flex" data-testid="app-sidebar-resize">
          <ResizeHandle side="left" onResize={resize} onDragEnd={endResize} />
        </div>
      )}
      {peek && !docked && (
        <div
          aria-hidden
          className="fixed inset-0 z-nav hidden md:block"
          onClick={() => setPeek(false)}
        />
      )}
      {!docked && !peek && <PeekButton onOpen={() => setPeek(true)} />}
    </>
  );
}

function PeekButton({ onOpen }: { onOpen: () => void }) {
  const hasUnread = useActivitySessions().items.some((item) => item.unread);
  return (
    <button
      type="button"
      aria-label="Show navigation"
      onClick={onOpen}
      className="fixed bottom-4 left-4 z-nav hidden md:flex size-10 items-center justify-center rounded-full border border-border bg-card text-foreground/80 shadow-lg transition-colors anim-in hover:bg-muted hover:text-foreground"
    >
      <OpenPanelLeft size={16} />
      {hasUnread && (
        <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary" />
      )}
    </button>
  );
}
