import type { CSSProperties } from "react";

import { SidebarTree } from "./sidebar-tree.js";

export function SidebarContent({
  onNavigate,
  style,
  collapsing = false,
}: {
  onNavigate?: () => void;
  style?: CSSProperties;
  collapsing?: boolean;
}) {
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
      style={style}
      data-testid="sidebar-agents-section"
    >
      <SidebarTree onNavigate={onNavigate} collapsing={collapsing} />
    </div>
  );
}
