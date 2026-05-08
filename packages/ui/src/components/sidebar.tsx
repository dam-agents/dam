import {
  Bot,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  Unplug,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import { getBrand } from "../brand.js";
import { InboxBell } from "../modules/approvals/components/inbox-bell.js";
import { useStore } from "../store.js";
import { Logo } from "./logo.js";

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
      {/* Logo */}
      <Button
        variant="ghost"
        onClick={() => setView("list")}
        className={cn("h-12 rounded-none justify-start gap-2.5 px-3.5", collapsed && "justify-center px-0")}
        title="Home"
      >
        <Logo size={22} className="text-primary shrink-0" />
        {!collapsed && (
          <span className="text-[15px] font-extrabold tracking-tight text-primary">
            {getBrand().short}
          </span>
        )}
      </Button>

      <Separator className="mx-2.5 w-auto" />

      {/* Nav items */}
      <div className="flex flex-col gap-0.5 mt-2 px-2">
        {navItems.map(({ view: v, label, icon: Icon }) => {
          const active = view === v;
          return (
            <Button
              key={v}
              variant={active ? "secondary" : "ghost"}
              onClick={() => setView(v)}
              title={collapsed ? label : undefined}
              className={cn(
                "h-9 justify-start gap-2.5",
                collapsed ? "justify-center px-0" : "px-2.5",
                active && "text-primary bg-primary/10 hover:bg-primary/15",
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
        <Separator className="mb-1 w-auto" />

        <InboxBell collapsed={collapsed} />

        <Button
          variant={view === "settings" ? "secondary" : "ghost"}
          onClick={() => setView("settings")}
          title={collapsed ? "Settings" : undefined}
          className={cn(
            "h-9 justify-start gap-2.5",
            collapsed ? "justify-center px-0" : "px-2.5",
            view === "settings" && "text-primary bg-primary/10 hover:bg-primary/15",
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
