import { useEffect, useRef, useState } from "react";

import { useFocusTrap } from "@/components/modal";
import { ResizeHandle } from "@/components/resize-handle";
import { prefersReducedMotion } from "@/components/ui/collapse";
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
  RIGHT_RAIL_W,
  SIDEBAR_COLLAPSED_W,
  SIDEBAR_MIN_W,
  sidebarMaxWidth,
  snapSidebarWidth,
} from "../../lib/sidebar-layout.js";
import { SidebarContent } from "./sidebar-content.js";
import { SidebarHeader } from "./sidebar-header.js";
import { SidebarRail } from "./sidebar-rail.js";
import { useCollapseContent } from "./use-collapse-content.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The desktop navigation pane, in two states: expanded, it holds its place beside the page at the width the user resizes, or collapsed, it stays at one icon's width as a rail of Agent avatars, each opening that Agent's Sessions beside it, with the Pinned section under its pin icon. The rail is what a narrow viewport gets whatever the user last chose, and expanding it there opens the pane over the page, from the left edge up to the right rail, until a Session is picked, Escape is pressed or the browser goes back; the user's own choice of expanded or collapsed is left as it was.
 */
// UNIT_BOUNDARY_DESCRIPTION: the tile the overlaid pane replaced, named once so the focus trap's dependencies stay still across renders; a new function each render would tear the trap down and grasp the pane's first row again.
const railExpandTile = () =>
  document.querySelector<HTMLElement>('[data-testid="sidebar-rail-expand"]');

export function SidebarV2() {
  const pinned = useStore((s) => s.sidebarPinned);
  const setPinned = useStore((s) => s.setSidebarPinned);
  const { width, resizing, setWidthTo, endResize } = useSidebarWidth({
    key: "platform-sidebar-v2-w",
    fallback: 325,
  });
  const { viewport } = useNarrowShell();
  const [overlaid, setOverlaid] = useState(false);

  const railed = useRef(false);
  const maxWidth = sidebarMaxWidth({
    viewport,
    rightRailWidth: RIGHT_RAIL_W,
    contentMinWidth: MIN_CONTENT_WIDTH,
  });
  // UNIT_BOUNDARY_DESCRIPTION: the room the navigation itself is about to take is the user's own doing while they drag it, so a drag never collapses the pane; a window with no room for a pane keeps the rail whatever the drag does.
  const paneFits = viewport - RIGHT_RAIL_W - MIN_CONTENT_WIDTH >= SIDEBAR_MIN_W;
  const mode = resizing
    ? pinned && paneFits
      ? "layout"
      : "rail"
    : navigationMode({
        viewport,
        sidebarWidth: width,
        rightRailWidth: RIGHT_RAIL_W,
        railed: railed.current,
      });
  railed.current = mode === "rail";
  const expanded = pinned && mode === "layout";
  // UNIT_BOUNDARY_DESCRIPTION: a drag is read from where it started and how far it has gone, so the edge stays under the pointer whatever the pane was clamped to on the way.
  const dragFrom = useRef<number | null>(null);
  const dragBy = useRef(0);
  const over = overlaid && mode === "rail";
  // UNIT_BOUNDARY_DESCRIPTION: over the page the pane is the only thing to reach, so Tab stays inside it and the way out is Escape, a Session, or going back.
  const navRef = useRef<HTMLElement>(null);
  useFocusTrap(navRef, over, railExpandTile);
  const { contentExpanded, moving, collapse } = useCollapseContent({
    expanded,
    animated: !resizing && !prefersReducedMotion(),
    target: navRef,
  });
  // UNIT_BOUNDARY_DESCRIPTION: the overlay belongs to the rail, so a window that widens enough for a pane drops it rather than opening the pane over the page again the next time the window narrows.
  useEffect(() => {
    if (mode !== "rail") setOverlaid(false);
  }, [mode]);
  useEffect(() => {
    if (!over) return;
    const release = holdBackEntry(() => {
      setOverlaid(false);
      return true;
    });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[role="menu"][data-state="open"]')) return;
      // UNIT_BOUNDARY_DESCRIPTION: a dialog the pane opened takes the Escape for itself, and closing the pane under it would unmount the row that holds it.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      setOverlaid(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      release();
    };
  }, [over]);

  return (
    <>
      <nav
        ref={navRef}
        className={cn(
          // UNIT_BOUNDARY_DESCRIPTION: the pane is the container its rows ask for their width, so a label that must end in an ellipsis at the pane's edge follows the width as the browser animates it, with no script in the loop.
          "@container flex flex-col border-r border-border bg-chrome",
          over
            ? "fixed inset-y-0 left-0 z-overlay"
            : "relative h-full shrink-0",
          !over &&
            "transition-[width] duration-200 ease-out motion-reduce:transition-none",
          resizing && "transition-none",
          !expanded && !over && "w-14 overflow-visible",
          moving && "overflow-hidden",
        )}
        style={
          // UNIT_BOUNDARY_DESCRIPTION: the pane reaches one pixel into the right rail so its own right border lands on the bar's left border, rather than beside it, and the two read as one line.
          over ? { right: RIGHT_RAIL_W - 1 } : expanded ? { width } : undefined
        }
        data-testid="app-sidebar"
        data-pinned={expanded || undefined}
        data-collapsed={!expanded || undefined}
      >
        {contentExpanded || over ? (
          <>
            <SidebarHeader
              expanded={expanded}
              onCollapse={() => {
                if (over) {
                  setOverlaid(false);
                  return;
                }
                setPinned(false);
                collapse();
              }}
            />
            <SidebarContent
              // UNIT_BOUNDARY_DESCRIPTION: while the width moves, the tree keeps the width the pane has when it is open, so the narrowing pane uncovers the tree rather than reflowing it, and the Home row, the Agent rows and their buttons keep their places throughout; the width is the pane's less the pixel its right border takes.
              style={moving ? { width: width - 1 } : undefined}
              collapsing={moving && !expanded}
              onNavigate={over ? () => setOverlaid(false) : undefined}
            />
          </>
        ) : (
          <SidebarRail
            onExpand={() =>
              mode === "rail" ? setOverlaid(true) : setPinned(true)
            }
          />
        )}
      </nav>
      {/* UNIT_BOUNDARY_DESCRIPTION: one handle serves the rail and the pane, so a drag that crosses between them keeps its grip instead of being cut short when the other handle would have taken over. */}
      {/* UNIT_BOUNDARY_DESCRIPTION: the edge is offered only where a pane fits beside the page at its narrowest, so a window too narrow for one opens the pane over the page instead. */}
      {!over && paneFits && (
        <div
          className="flex"
          data-testid={
            expanded ? "app-sidebar-resize" : "app-sidebar-resize-rail"
          }
        >
          <ResizeHandle
            side="left"
            label="Resize navigation"
            value={expanded ? width : SIDEBAR_COLLAPSED_W}
            onResize={(delta) => {
              // UNIT_BOUNDARY_DESCRIPTION: the snap reads the drag as the user made it rather than the width the drag was last held to, so pulling the edge most of the way down gives the navigation up instead of resting at its narrowest.
              dragFrom.current ??= expanded ? width : SIDEBAR_COLLAPSED_W;
              dragBy.current += delta;
              const snapped = snapSidebarWidth(
                dragFrom.current + dragBy.current,
                maxWidth,
              );
              if (snapped === "rail" || !paneFits) setPinned(false);
              else {
                setPinned(true);
                setWidthTo(snapped, maxWidth);
              }
            }}
            onDragEnd={() => {
              dragBy.current = 0;
              dragFrom.current = null;
              endResize();
            }}
          />
        </div>
      )}
    </>
  );
}
