import { SidebarColumns } from "./sidebar-columns.js";

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
      data-testid="sidebar-agents-section"
    >
      <SidebarColumns onNavigate={onNavigate} />
    </div>
  );
}
