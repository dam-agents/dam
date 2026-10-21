import { useEffect, useRef, useState } from "react";

import { ResizeHandle } from "@/components/resize-handle";
import { SideDrawer } from "@/components/ui/side-drawer";
import {
  MIN_CONTENT_WIDTH,
  navigationMode,
  useNarrowShell,
} from "@/lib/breakpoints";
import { cn } from "@/lib/utils";

import { useStore } from "../../../../store.js";
import { useSidebarWidth } from "../../hooks/use-sidebar-layout.js";
import { holdBackEntry } from "../../lib/back-entry.js";
import {
  SIDEBAR_COLLAPSED_W,
  sidebarMaxWidth,
  snapSidebarWidth,
} from "../../lib/sidebar-layout.js";
import { SidebarContent } from "./sidebar-content.js";
import { SidebarHeader } from "./sidebar-header.js";
import { SidebarRail } from "./sidebar-rail.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The desktop navigation pane, in two states: expanded, it holds its place beside the page at the width the user resizes, or collapsed, it stays at one icon's width as a rail of Agent avatars, each opening that Agent's Sessions beside it, with the Pinned section under its pin icon. The rail is what a narrow viewport gets whatever the user last chose, and expanding it there opens the pane over the page, from the left edge up to the right rail, until a Session is picked, Escape is pressed or the browser goes back; the user's own choice of expanded or collapsed is left as it was.
 */
export function SidebarV2() {
  const pinned = useStore((s) => s.sidebarPinned);
  const setPinned = useStore((s) => s.setSidebarPinned);
  const setView = useStore((s) => s.setView);
  const { width, resizing, setWidthTo, endResize } = useSidebarWidth({
    key: "platform-sidebar-v2-w",
    fallback: 325,
  });
  const { viewport } = useNarrowShell();
  const [overlaid, setOverlaid] = useState(false);

  const railed = useRef(false);
  // UNIT_BOUNDARY_DESCRIPTION: the room the navigation itself is about to take is the user's own doing while they drag it, so the drag never changes the mode; only a viewport or a rail that no longer fits it does.
  const mode = resizing
    ? railed.current
      ? "rail"
      : "layout"
    : navigationMode({
        viewport,
        sidebarWidth: width,
        rightRailWidth: 60,
        railed: railed.current,
      });
  railed.current = mode === "rail";
  const expanded = pinned && mode === "layout";
  const maxWidth = sidebarMaxWidth({
    viewport,
    rightRailWidth: 60,
    contentMinWidth: MIN_CONTENT_WIDTH,
  });
  // UNIT_BOUNDARY_DESCRIPTION: a drag is read from where it started and how far it has gone, so the edge stays under the pointer whatever the pane was clamped to on the way.
  const dragFrom = useRef<number | null>(null);
  const dragBy = useRef(0);
  const over = overlaid && mode === "rail";

  useEffect(() => {
    if (!over) return;
    const release = holdBackEntry(() => {
      setOverlaid(false);
      return true;
    });
    return release;
  }, [over]);

  return (
    <>
      <nav
        className={cn(
          "relative flex h-full shrink-0 flex-col border-r border-border bg-chrome",
          "transition-[width] duration-200 ease-out motion-reduce:transition-none",
          resizing && "transition-none",
          !expanded && "w-14 overflow-visible",
        )}
        style={expanded ? { width } : undefined}
        data-testid="app-sidebar"
        data-pinned={expanded || undefined}
        data-collapsed={!expanded || undefined}
      >
        {expanded ? (
          <>
            <SidebarHeader
              onCollapse={() => setPinned(false)}
              onHome={() => setView("home")}
            />
            <SidebarContent />
          </>
        ) : (
          <SidebarRail
            onExpand={() =>
              mode === "rail" ? setOverlaid(true) : setPinned(true)
            }
          />
        )}
      </nav>
      {mode === "rail" && !over && (
        <div className="flex" data-testid="app-sidebar-resize-rail">
          <ResizeHandle
            side="left"
            label="Resize navigation"
            value={SIDEBAR_COLLAPSED_W}
            onResize={(delta) => {
              dragBy.current += delta;
              const dragged = SIDEBAR_COLLAPSED_W + dragBy.current;
              if (snapSidebarWidth(dragged, maxWidth) === "rail") return;
              setPinned(true);
              setWidthTo(dragged, maxWidth);
            }}
            onDragEnd={() => {
              dragBy.current = 0;
              dragFrom.current = null;
              endResize();
            }}
          />
        </div>
      )}
      {expanded && (
        <div className="flex" data-testid="app-sidebar-resize">
          <ResizeHandle
            side="left"
            label="Resize navigation"
            value={width}
            onResize={(delta) => {
              // UNIT_BOUNDARY_DESCRIPTION: the snap reads the drag as the user made it rather than the width the drag was last held to, so pulling the edge most of the way down gives the navigation up instead of resting at its narrowest.
              dragFrom.current ??= width;
              dragBy.current += delta;
              const snapped = snapSidebarWidth(
                dragFrom.current + dragBy.current,
                maxWidth,
              );
              if (snapped === "rail") {
                setPinned(false);
                return;
              }
              setWidthTo(snapped, maxWidth);
            }}
            onDragEnd={() => {
              dragBy.current = 0;
              dragFrom.current = null;
              endResize();
            }}
          />
        </div>
      )}
      {over && (
        <SideDrawer
          side="left"
          label="Navigation"
          closing={false}
          onClose={() => setOverlaid(false)}
          onClosed={() => {}}
          showBackdrop={false}
          animated={false}
          // UNIT_BOUNDARY_DESCRIPTION: a narrow viewport has no room for a page beside the navigation, so the navigation takes the screen up to the right rail rather than lying over the page.
          containerClassName="right-[60px]"
          className="w-full"
        >
          <SidebarHeader
            onCollapse={() => setOverlaid(false)}
            onHome={() => {
              setView("home");
              setOverlaid(false);
            }}
          />
          <SidebarContent onNavigate={() => setOverlaid(false)} />
        </SideDrawer>
      )}
    </>
  );
}
