import { ChevronLeft } from "@carbon/icons-react";

import { getBrand } from "../../../../brand.js";
import { NavRow } from "./add-row.js";

interface Props {
  expanded: boolean;
  onCollapse: () => void;
}

// UNIT_BOUNDARY_DESCRIPTION: the row above the tree is a row like Home and Settings, its icon the chevron that collapses the pane and its label the brand, and the whole row is the one target that collapses it; the brand leads nowhere on its own, since Home is a row of its own.
export function SidebarHeader({ expanded, onCollapse }: Props) {
  return (
    <div className="flex h-12 shrink-0 items-start px-2">
      <NavRow
        icon={ChevronLeft}
        label={getBrand().name}
        testId="sidebar-collapse-row"
        ariaLabel="Collapse navigation"
        ariaExpanded={expanded}
        onClick={onCollapse}
      />
    </div>
  );
}
