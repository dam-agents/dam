import { useEffect, useRef, useState } from "react";

import { ResizeHandle } from "@/components/resize-handle";
import { SideDrawer } from "@/components/ui/side-drawer";
import { navigationMode, useNarrowShell } from "@/lib/breakpoints";
import { cn } from "@/lib/utils";

import { useStore } from "../../../../store.js";
import { useSidebarWidth } from "../../hooks/use-sidebar-layout.js";
import { holdBackEntry } from "../../lib/back-entry.js";
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
  const { width, resize, endResize } = useSidebarWidth({
    key: "platform-sidebar-v2-w",
    fallback: 325,
  });
  const { viewport } = useNarrowShell();
  const [resizing, setResizing] = useState(false);
  const [overlaid, setOverlaid] = useState(false);

  const railed = useRef(false);
  const mode = navigationMode({
    viewport,
    sidebarWidth: width,
    rightRailWidth: 60,
    railed: railed.current,
  });
  railed.current = mode === "rail";
  const expanded = pinned && mode === "layout";
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
      {expanded && (
        <div className="flex" data-testid="app-sidebar-resize">
          <ResizeHandle
            side="left"
            onResize={(next) => {
              setResizing(true);
              resize(next);
            }}
            onDragEnd={() => {
              setResizing(false);
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
          containerClassName={cn(`right-14`, "md:right-[60px]")}
          className="w-[min(325px,calc(100%-56px))]"
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
