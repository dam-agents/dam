import { Bot } from "@carbon/icons-react";

import { ResizeHandle } from "@/components/resize-handle";
import { PANE_MOTION } from "@/lib/pane-motion";
import { cn } from "@/lib/utils";

import { useStore } from "../../../../store.js";
import { SidebarAgents } from "../../../agents/components/sidebar-agents.js";
import { HomeWidgets } from "../../../home/components/home-widgets.js";
import { useActivitySessions } from "../../../home/hooks/use-activity-sessions.js";
import { useSidebarDestinations } from "../../hooks/use-sidebar-destinations.js";
import { useSidebarWidth } from "../../hooks/use-sidebar-layout.js";
import { SIDEBAR_COLLAPSED_W } from "../../lib/sidebar-layout.js";
import { SidebarContent } from "./sidebar-content.js";
import { SidebarFlyout } from "./sidebar-flyout.js";
import { SidebarHeader } from "./sidebar-header.js";
import { SidebarNavItem } from "./sidebar-nav-item.js";

export function Sidebar({ home = false }: { home?: boolean }) {
  const expanded = useStore((s) => s.sidebarExpanded);
  const setExpanded = useStore((s) => s.setSidebarExpanded);
  const destinations = useSidebarDestinations();
  const { width, resizing, resize, endResize } = useSidebarWidth();
  const wide = home || expanded;

  return (
    <>
      <nav
        className={cn(
          "hidden md:flex flex-col h-full min-w-0 overflow-hidden px-2 bg-card border-border",
          !home && "border-r",
          !resizing && PANE_MOTION,
        )}
        style={{
          flex: `${home ? 1 : 0} 0 ${wide ? width : SIDEBAR_COLLAPSED_W}px`,
        }}
        data-testid="app-sidebar"
        data-home={home || undefined}
      >
        {wide ? (
          <div
            className={cn(
              "mx-auto flex min-h-0 w-full flex-1 flex-col",
              PANE_MOTION,
              home ? "max-w-[960px] px-4 pt-6 lg:px-[5%]" : "max-w-full",
            )}
          >
            <SidebarHeader
              expanded
              onToggle={home ? undefined : () => setExpanded(!expanded)}
              onHome={destinations.home.navigate}
            />
            <SidebarContent
              stickyHeaderClassName="bg-card"
              lead={<HomeWidgets open={home} />}
            />
          </div>
        ) : (
          <>
            <SidebarHeader
              expanded={false}
              onToggle={() => setExpanded(true)}
              onHome={destinations.home.navigate}
            />
            <CollapsedRail />
          </>
        )}
      </nav>
      {expanded && !home && (
        <div className="hidden md:flex" data-testid="app-sidebar-resize">
          <ResizeHandle side="left" onResize={resize} onDragEnd={endResize} />
        </div>
      )}
    </>
  );
}

function CollapsedRail() {
  const { primary, secondary } = useSidebarDestinations();
  const hasUnread = useActivitySessions().items.some((item) => item.unread);

  return (
    <>
      <div className="mt-px flex flex-col gap-px">
        {primary.map((destination) => (
          <SidebarNavItem
            key={destination.label}
            {...destination}
            expanded={false}
          />
        ))}
      </div>
      <div className="mt-4 flex flex-col gap-px">
        <SidebarFlyout label="Agents" icon={Bot} badge={hasUnread}>
          {(close) => (
            <SidebarAgents
              stickyHeaderClassName="bg-popover"
              onNavigate={close}
            />
          )}
        </SidebarFlyout>
      </div>
      <div className="flex-1" />
      <div className="mb-2 flex flex-col gap-px">
        {secondary.map((destination) => (
          <SidebarNavItem
            key={destination.label}
            {...destination}
            expanded={false}
          />
        ))}
      </div>
    </>
  );
}
