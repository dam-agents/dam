import { Bot, Connect, Menu, Model, Settings } from "@carbon/icons-react";
import { useEffect, useState } from "react";

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

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  return (
    <nav
      className={cn(
        "hidden md:flex flex-col h-full bg-card border-r shrink-0 transition-[width] duration-200",
        collapsed ? "w-[52px]" : "w-[200px]",
      )}
    >
      {/* Brand row — hamburger always lives at the same x-offset as the
          nav icons below; brand text fades out when collapsed but the
          hamburger stays put so nothing visually shifts during the
          width transition. */}
      <div className="flex items-center h-12 px-2">
        <Button
          variant="ghost"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="h-9 px-2.5 shrink-0 justify-start hover:bg-transparent"
        >
          <Menu className="shrink-0" />
        </Button>
        {!collapsed && (
          <Button
            variant="ghost"
            onClick={() => setView("list")}
            className="h-9 px-0 justify-start flex-1 hover:bg-transparent"
            title="Home"
          >
            <span className="text-sm text-foreground">
              <span className="font-normal">IBM Research </span>
              <span className="font-semibold">DAM</span>
            </span>
          </Button>
        )}
      </div>

      {/* Nav items — icon + label rows. Always left-aligned so icons
          stay anchored at the same x-offset; the label just hides on
          collapse and the sidebar shrinks around the icon. */}
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
                "h-9 justify-start gap-2.5 px-2.5",
                active && "bg-muted",
              )}
            >
              <Icon className="shrink-0" />
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
            "h-9 justify-start gap-2.5 px-2.5",
            view === "settings" && "bg-muted",
          )}
        >
          <Settings className="shrink-0" />
          {!collapsed && <span className="text-sm font-medium">Settings</span>}
        </Button>
      </div>
    </nav>
  );
}
