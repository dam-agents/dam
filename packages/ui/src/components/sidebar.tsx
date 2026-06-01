import { useEffect, useState } from "react";

import { DamSquareLogo, DamSquareLogoDark } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { InboxBell } from "../modules/approvals/components/inbox-bell.js";
import { useStore } from "../store.js";

const STORAGE_KEY = "platform-sidebar-collapsed";

const navItems = [
  { view: "list" as const, label: "Agents" },
  { view: "providers" as const, label: "Providers" },
  { view: "connections" as const, label: "Connections" },
] as const;

export function Sidebar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === "true",
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  return (
    <nav
      className={cn(
        "hidden md:flex flex-col h-full bg-card border-r shrink-0 transition-[width] duration-200",
        collapsed ? "w-[52px]" : "w-[200px]",
      )}
      data-testid="app-sidebar"
    >
      {/* Brand row — DAM mark click toggles collapse. The viewBox on
          DamSquareLogo is cropped tightly around the letters so the
          rendered DAM dominates whatever pixel size the row gives it. */}
      {/* Plain <button> instead of the shadcn <Button> wrapper — that
          component's `[&_svg]:size-4` rule force-shrinks any SVG inside
          it to 16px regardless of the className put on the SVG. The
          18px left offset matches the x-position of the nav items'
          text below (row px-2 + button px-2.5). */}
      <div className="flex items-center h-14 pl-[18px]">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <DamSquareLogo className="h-8 w-8 block dark:hidden" />
          <DamSquareLogoDark className="h-8 w-8 hidden dark:block" />
        </button>
      </div>

      {/* Nav items — labels only on desktop. Icons live in the mobile
          nav component; on this sidebar the row vocabulary is purely
          textual. */}
      <div className="flex flex-col gap-0.5 mt-2 px-2">
        {navItems.map(({ view: v, label }) => {
          const active = view === v;
          return (
            <Button
              key={v}
              id={`tour-nav-${v}`}
              variant="ghost"
              onClick={() => setView(v)}
              title={collapsed ? label : undefined}
              className={cn("h-9 justify-start px-2.5", active && "bg-muted")}
            >
              {!collapsed && (
                <span className="text-sm font-medium">{label}</span>
              )}
            </Button>
          );
        })}
      </div>

      <div className="flex-1" />

      <div className="flex flex-col gap-0.5 px-2 mb-2">
        <InboxBell collapsed={collapsed} />

        <Button
          variant="ghost"
          onClick={() => setView("settings")}
          title={collapsed ? "Settings" : undefined}
          className={cn(
            "h-9 justify-start px-2.5",
            view === "settings" && "bg-muted",
          )}
        >
          {!collapsed && <span className="text-sm font-medium">Settings</span>}
        </Button>
      </div>
    </nav>
  );
}
