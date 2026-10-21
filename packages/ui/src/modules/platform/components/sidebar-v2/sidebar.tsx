import { useState } from "react";

import { ResizeHandle } from "@/components/resize-handle";
import { cn } from "@/lib/utils";

import { useStore } from "../../../../store.js";
import { useSidebarWidth } from "../../hooks/use-sidebar-layout.js";
import { SidebarContent } from "./sidebar-content.js";
import { SidebarHeader } from "./sidebar-header.js";
import { SidebarRail } from "./sidebar-rail.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The desktop navigation pane, in two states: expanded, it holds its place beside the page at the width the user resizes, or collapsed, it stays at one icon's width as a rail of Agent avatars, each opening that Agent's Sessions beside it, with the Pinned section under its pin icon.
 */
export function SidebarV2() {
  const expanded = useStore((s) => s.sidebarPinned);
  const setExpanded = useStore((s) => s.setSidebarPinned);
  const setView = useStore((s) => s.setView);
  const { width, resize, endResize } = useSidebarWidth({
    key: "platform-sidebar-v2-w",
    fallback: 325,
  });
  const [resizing, setResizing] = useState(false);

  return (
    <>
      <nav
        className={cn(
          "relative hidden h-full shrink-0 flex-col border-r border-border bg-chrome md:flex",
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
              onCollapse={() => setExpanded(false)}
              onHome={() => setView("home")}
            />
            <SidebarContent />
          </>
        ) : (
          <SidebarRail onExpand={() => setExpanded(true)} />
        )}
      </nav>
      {expanded && (
        <div className="hidden md:flex" data-testid="app-sidebar-resize">
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
    </>
  );
}
