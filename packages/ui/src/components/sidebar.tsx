import { Bot, Connect, Model, Settings } from "@carbon/icons-react";
import { useEffect, useState } from "react";

import { DamSquareLogo, DamSquareLogoDark } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { InboxBell } from "../modules/approvals/components/inbox-bell.js";
import { useStore } from "../store.js";

const STORAGE_KEY = "platform-sidebar-collapsed";

const navItems = [
  { view: "list" as const, label: "Agents", icon: Bot },
  { view: "providers" as const, label: "Providers", icon: Model },
  { view: "connections" as const, label: "Connections", icon: Connect },
] as const;

export function Sidebar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === "true",
  );
  // `iconMode` drives the label↔icon swap and lags `collapsed`: on collapse
  // it flips only after the width transition finishes, on expand it flips
  // immediately. That keeps the width animation smooth — labels clip away as
  // the rail narrows, then icons appear once it's settled — instead of icons
  // popping in at full width mid-animation.
  const [iconMode, setIconMode] = useState(collapsed);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(collapsed));
    if (!collapsed) {
      setIconMode(false);
      return;
    }
    const t = setTimeout(() => setIconMode(true), 200);
    return () => clearTimeout(t);
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
          rendered DAM dominates whatever pixel size the row gives it. The
          18px left offset (expanded) matches the x-position of the nav
          items' icons below (row px-2 + button px-2.5). */}
      <div
        className={cn(
          "flex items-center h-14",
          iconMode ? "justify-center" : "pl-[18px]",
        )}
      >
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

      {/* Nav items — labels in the expanded sidebar (per the design),
          collapsing to icon-only so the rail stays legible. */}
      <div className="flex flex-col gap-0.5 mt-2 px-2">
        {navItems.map(({ view: v, label, icon: Icon }) => {
          const active = view === v;
          return (
            <Button
              key={v}
              id={`tour-nav-${v}`}
              variant="ghost"
              onClick={() => setView(v)}
              title={collapsed ? label : undefined}
              className={cn(
                "h-9 overflow-hidden",
                iconMode ? "justify-center px-0" : "justify-start px-2.5",
                active && "bg-muted",
              )}
            >
              {iconMode ? (
                <Icon />
              ) : (
                <span className="text-sm font-medium whitespace-nowrap">
                  {label}
                </span>
              )}
            </Button>
          );
        })}
      </div>

      <div className="flex-1" />

      <div className="flex flex-col gap-0.5 px-2 mb-2">
        <InboxBell collapsed={iconMode} />

        <Button
          variant="ghost"
          onClick={() => setView("settings")}
          title={collapsed ? "Settings" : undefined}
          className={cn(
            "h-9 overflow-hidden",
            iconMode ? "justify-center px-0" : "justify-start px-2.5",
            view === "settings" && "bg-muted",
          )}
        >
          {iconMode ? (
            <Settings />
          ) : (
            <span className="text-sm font-medium whitespace-nowrap">
              Settings
            </span>
          )}
        </Button>
      </div>
    </nav>
  );
}
