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

  return (
    <>
      <nav
        className={cn(
          "relative hidden h-full shrink-0 flex-col border-r border-border bg-chrome md:flex",
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
          <ResizeHandle side="left" onResize={resize} onDragEnd={endResize} />
        </div>
      )}
    </>
  );
}
