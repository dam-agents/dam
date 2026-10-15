import { SidebarAgents } from "../../../agents/components/sidebar-agents.js";
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

  return (
    <>
      <div className="mt-px flex flex-col gap-px">{primary.map(item)}</div>
      <div className="-mx-2 mt-6 min-h-0 flex-1 overflow-y-auto px-2 pb-4 [overflow-anchor:none]">
        <SidebarAgents onNavigate={onNavigate} />
        <div className="mt-6">
          <SidebarActivity
            stickyHeaderClassName={stickyHeaderClassName}
            onNavigate={onNavigate}
          />
        </div>
      </div>
      <div className="mb-2 flex flex-col gap-px">{secondary.map(item)}</div>
    </>
  );
}
