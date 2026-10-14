import { Activity, Bot } from "@carbon/icons-react";

import { cn } from "@/lib/utils";

import { useStore } from "../../../../store.js";
import { SidebarAgents } from "../../../agents/components/sidebar-agents.js";
import { SidebarActivity } from "../../../home/components/sidebar-activity.js";
import { useActivitySessions } from "../../../home/hooks/use-activity-sessions.js";
import { useSidebarDestinations } from "../../hooks/use-sidebar-destinations.js";
import { MobileBottomBar } from "./mobile-bottom-bar.js";
import { SidebarFlyout } from "./sidebar-flyout.js";
import { SidebarHeader } from "./sidebar-header.js";
import { SidebarNavItem } from "./sidebar-nav-item.js";

export function Sidebar({
  hideMobileBar = false,
}: {
  hideMobileBar?: boolean;
}) {
  const expanded = useStore((s) => s.sidebarExpanded);
  const setExpanded = useStore((s) => s.setSidebarExpanded);
  const { home, primary, secondary } = useSidebarDestinations();
  const hasUnread = useActivitySessions().items.some((item) => item.unread);

  return (
    <>
      <nav
        className={cn(
          "hidden md:flex flex-col h-full px-2 bg-card border-r border-border shrink-0 transition-[width]",
          expanded ? "w-[260px]" : "w-[56px]",
        )}
        data-testid="app-sidebar"
      >
        <SidebarHeader
          expanded={expanded}
          onToggle={() => setExpanded(!expanded)}
          onHome={home.navigate}
        />
        <div className="mt-px flex flex-col gap-px">
          {primary.map((destination) => (
            <SidebarNavItem
              key={destination.label}
              {...destination}
              expanded={expanded}
            />
          ))}
        </div>
        {expanded ? (
          <div className="-mx-2 mt-6 min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            <SidebarAgents />
            <div className="mt-6">
              <SidebarActivity stickyHeaderClassName="bg-card" />
            </div>
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-col gap-px">
              <SidebarFlyout label="Agents" icon={Bot}>
                {(close) => <SidebarAgents onNavigate={close} />}
              </SidebarFlyout>
              <SidebarFlyout label="Activity" icon={Activity} badge={hasUnread}>
                {(close) => (
                  <SidebarActivity
                    stickyHeaderClassName="bg-popover"
                    onNavigate={close}
                  />
                )}
              </SidebarFlyout>
            </div>
            <div className="flex-1" />
          </>
        )}
        <div className="mb-2 flex flex-col gap-px">
          {secondary.map((destination) => (
            <SidebarNavItem
              key={destination.label}
              {...destination}
              expanded={expanded}
            />
          ))}
        </div>
      </nav>

      {!hideMobileBar && (
        <MobileBottomBar destinations={[...primary, ...secondary]} />
      )}
    </>
  );
}
