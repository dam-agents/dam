import { cn } from "@/lib/utils";

import type { SidebarDestination } from "../../hooks/use-sidebar-destinations.js";

export function MobileBottomBar({
  destinations,
}: {
  destinations: readonly SidebarDestination[];
}) {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-nav flex items-stretch border-t bg-card/95 backdrop-blur-xl safe-bottom">
      {destinations.map(
        ({ label, shortLabel, icon: Icon, active, navigate }) => (
          <button
            key={label}
            type="button"
            onClick={navigate}
            aria-label={label}
            className={cn(
              "flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Icon size={20} />
            <span className="max-w-full truncate text-[10px] font-semibold">
              {shortLabel ?? label}
            </span>
          </button>
        ),
      )}
    </nav>
  );
}
