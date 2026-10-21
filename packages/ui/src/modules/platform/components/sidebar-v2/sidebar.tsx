import { useEffect, useRef, useState } from "react";

import { useFocusTrap } from "@/components/modal";
import { ResizeHandle } from "@/components/resize-handle";
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
        rightRailWidth: RIGHT_RAIL_W,
        railed: railed.current,
      });
  railed.current = mode === "rail";
  const expanded = pinned && mode === "layout";
  const maxWidth = sidebarMaxWidth({
    viewport,
    rightRailWidth: RIGHT_RAIL_W,
    contentMinWidth: MIN_CONTENT_WIDTH,
  });
  // UNIT_BOUNDARY_DESCRIPTION: a drag is read from where it started and how far it has gone, so the edge stays under the pointer whatever the pane was clamped to on the way.
  const dragFrom = useRef<number | null>(null);
  const dragBy = useRef(0);
  const over = overlaid && mode === "rail";
  // UNIT_BOUNDARY_DESCRIPTION: over the page the pane is the only thing to reach, so Tab stays inside it and the way out is Escape, a Session, or going back.
  const navRef = useRef<HTMLElement>(null);
  useFocusTrap(navRef, over);
  useEffect(() => {
    if (!over) return;
    const release = holdBackEntry(() => {
      setOverlaid(false);
      return true;
    });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[role="menu"][data-state="open"]')) return;
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
          "flex flex-col border-r border-border bg-chrome",
          over
            ? "fixed inset-y-0 left-0 z-overlay"
            : "relative h-full shrink-0",
          !over &&
            "transition-[width] duration-200 ease-out motion-reduce:transition-none",
          resizing && "transition-none",
          !expanded && !over && "w-14 overflow-visible",
        )}
        style={
          over ? { right: RIGHT_RAIL_W } : expanded ? { width } : undefined
        }
        data-testid="app-sidebar"
        data-pinned={expanded || undefined}
        data-collapsed={!expanded || undefined}
      >
        {expanded || over ? (
          <>
            <SidebarHeader
              onCollapse={() => (over ? setOverlaid(false) : setPinned(false))}
              onHome={() => {
                setView("home");
                if (over) setOverlaid(false);
              }}
            />
            <SidebarContent
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
    </>
  );
}
