import { useStore } from "../../../../store.js";
import { SidebarColumns } from "./sidebar-columns.js";
import { SidebarUsage } from "./sidebar-usage.js";

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const setView = useStore((s) => s.setView);
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
      data-testid="sidebar-agents-section"
    >
      <SidebarColumns
        onNavigate={onNavigate}
        footer={
          <div className="flex h-[57px] shrink-0 flex-col justify-center border-t border-border px-2">
            <SidebarUsage
              onOpen={() => {
                setView("home");
                onNavigate?.();
              }}
            />
          </div>
        }
      />
    </div>
  );
}
