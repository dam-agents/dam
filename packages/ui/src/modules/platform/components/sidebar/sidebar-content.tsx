import { Book, Settings } from "@carbon/icons-react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { DOCS_URL } from "../../../../constants.js";
import { useStore } from "../../../../store.js";
import { SidebarColumns } from "./sidebar-columns.js";
import { SIDEBAR_ITEM, sidebarItemTone } from "./sidebar-nav-item.js";
import { SidebarUsage } from "./sidebar-usage.js";

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const go = (fn: () => void) => () => {
    fn();
    onNavigate?.();
  };

  return (
    <>
      <div
        className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
        data-testid="sidebar-agents-section"
      >
        <SidebarColumns onNavigate={onNavigate} />
      </div>
      <div className="flex flex-col gap-1 border-t border-border p-2">
        <SidebarUsage onOpen={go(() => setView("home"))} />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={go(() => navigateToSettings())}
            aria-current={view === "settings" ? "page" : undefined}
            className={cn(
              SIDEBAR_ITEM,
              "flex-1",
              sidebarItemTone(view === "settings"),
            )}
          >
            <Settings size={16} />
            <span className="truncate text-sm font-medium">Settings</span>
          </button>
          <Tooltip content="Documentation" side="top">
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Documentation"
              className="flex size-[34px] shrink-0 items-center justify-center rounded-lg text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
            >
              <Book size={16} />
            </a>
          </Tooltip>
        </div>
      </div>
    </>
  );
}
