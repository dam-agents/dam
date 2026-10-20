import { ResizeHandle } from "@/components/resize-handle";

import { SidebarAgents } from "../../../agents/components/sidebar-agents.js";
import { SidebarActivity } from "../../../home/components/sidebar-activity.js";
import {
  type SidebarDestination,
  useSidebarDestinations,
} from "../../hooks/use-sidebar-destinations.js";
import { useSidebarSections } from "../../hooks/use-sidebar-layout.js";
import { activitySectionStyle } from "../../lib/sidebar-layout.js";
import { SidebarNavItem } from "./sidebar-nav-item.js";

export function SidebarContent({
  stickyHeaderClassName,
  onNavigate,
}: {
  stickyHeaderClassName: string;
  onNavigate?: () => void;
}) {
  const { primary, secondary } = useSidebarDestinations();
  const sections = useSidebarSections();
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
      <div className="-mx-2 mt-6 flex min-h-0 flex-1 flex-col pb-4">
        <div
          ref={sections.agentsRef}
          style={sections.agentsStyle}
          className="overflow-y-auto px-2"
          data-testid="sidebar-agents-section"
        >
          <SidebarAgents
            stickyHeaderClassName={stickyHeaderClassName}
            onNavigate={onNavigate}
          />
        </div>
        <div className="py-2.5">
          <ResizeHandle
            orientation="vertical"
            label="Resize the Agents and Activity sections"
            onResize={sections.resize}
            onDragEnd={sections.endResize}
          />
        </div>
        <div
          ref={sections.activityRef}
          style={activitySectionStyle}
          className="overflow-y-auto px-2"
          data-testid="sidebar-activity-section"
        >
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
