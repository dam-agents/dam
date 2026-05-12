import {
  AiLaunch as Sparkles,
  Bot,
  OpenPanelLeft as PanelLeftOpen,
  Settings,
  SidePanelClose as PanelLeftClose,
  Unlink as Unplug,
} from "@carbon/icons-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { getBrand } from "../brand.js";
import { InboxBell } from "../modules/approvals/components/inbox-bell.js";
import { useStore } from "../store.js";

const STORAGE_KEY = "platform-sidebar-collapsed";

const navItems = [
  { view: "list" as const, label: "Agents", icon: Bot },
  { view: "providers" as const, label: "Providers", icon: Sparkles },
  { view: "connections" as const, label: "Connections", icon: Unplug },
] as const;

export function Sidebar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEY) === "true");

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
      {/* Brand */}
      <Button
        variant="ghost"
        onClick={() => setView("list")}
        className={cn("h-12 rounded-none justify-start px-3.5", collapsed && "justify-center px-0")}
        title="Home"
      >
        <span className="text-[15px] font-extrabold tracking-tight text-foreground uppercase">
          {getBrand().short}
        </span>
      </Button>

      {/* Nav items */}
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
                "h-9 justify-start gap-2.5",
                collapsed ? "justify-center px-0" : "px-2.5",
                active && "bg-muted",
              )}
            >
              <Icon className="shrink-0" />
              {!collapsed && <span className="text-sm font-medium">{label}</span>}
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
            "h-9 justify-start gap-2.5",
            collapsed ? "justify-center px-0" : "px-2.5",
            view === "settings" && "bg-muted",
          )}
        >
          <Settings className="shrink-0" />
          {!collapsed && <span className="text-sm font-medium">Settings</span>}
        </Button>

        <Button
          variant="ghost"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn("h-9 justify-start gap-2.5", collapsed ? "justify-center px-0" : "px-2.5")}
        >
          {collapsed ? (
            <PanelLeftOpen className="shrink-0" />
          ) : (
            <PanelLeftClose className="shrink-0" />
          )}
          {!collapsed && <span className="text-sm font-medium">Collapse</span>}
        </Button>
      </div>
    </nav>
  );
}
