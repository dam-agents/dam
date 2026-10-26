import { cn } from "@/lib/utils";

import { SidebarAgents } from "../../../agents/components/sidebar-agents.js";
import { SidebarSharedAgents } from "../../../agents/components/sidebar-shared-agents.js";
import { SidebarActivity } from "../../../home/components/sidebar-activity.js";
import {
  type SidebarDestination,
  useSidebarDestinations,
} from "../../hooks/use-sidebar-destinations.js";
import { SidebarNavItem } from "./sidebar-nav-item.js";

export function SidebarContent({
  stickyHeaderClassName,
  onNavigate,
}: {
  stickyHeaderClassName: string;
  onNavigate?: () => void;
}) {
  const { primary, secondary } = useSidebarDestinations();
  const item = (destination: SidebarDestination) => (
    <SidebarNavItem
      key={destination.label}
      {...destination}
      navigate={() => {
        destination.navigate();
        onNavigate?.();
      }}
      expanded
    />
  );

  const sticky = cn(stickyHeaderClassName, "-mx-2 pr-3 pl-5");

  return (
    <>
      <div className="mt-px flex flex-col gap-px">{primary.map(item)}</div>
      <div
        className="relative -mx-2 mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-4"
        data-testid="sidebar-sections"
      >
        <div data-testid="sidebar-agents-section">
          <SidebarAgents
            stickyHeaderClassName={sticky}
            onNavigate={onNavigate}
          />
        </div>
        <SidebarSharedAgents
          stickyHeaderClassName={sticky}
          onNavigate={onNavigate}
        />
        <div className="mt-6" data-testid="sidebar-activity-section">
          <SidebarActivity
            stickyHeaderClassName={sticky}
            onNavigate={onNavigate}
          />
        </div>
      </div>
      <div className="mb-2 flex flex-col gap-px">{secondary.map(item)}</div>
    </>
  );
}
