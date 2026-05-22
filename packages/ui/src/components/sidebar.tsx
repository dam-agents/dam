import {
  BarChart3,
  Bot,
  type LucideIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  Unplug,
} from "lucide-react";
import { useEffect, useState } from "react";

import { isUsageInspector } from "../auth.js";
import { getBrand } from "../brand.js";
import { InboxBell } from "../modules/approvals/components/inbox-bell.js";
import { openUsageReport } from "../modules/usage/api/open-usage-report.js";
import { useStore } from "../store.js";
import { Logo } from "./logo.js";

const STORAGE_KEY = "platform-sidebar-collapsed";

type RouteView = "list" | "providers" | "connections";
type NavItem = { label: string; icon: LucideIcon } & (
  | { view: RouteView }
  | { action: () => void }
);

export function Sidebar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  // Static at mount; role changes take effect on next page reload.
  const showUsage = isUsageInspector();

  const navItems: NavItem[] = [
    { view: "list", label: "Agents", icon: Bot },
    { view: "providers", label: "Providers", icon: Sparkles },
    { view: "connections", label: "Connections", icon: Unplug },
    ...(showUsage
      ? [{ action: openUsageReport, label: "Usage", icon: BarChart3 }]
      : []),
  ];

  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) === "true";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  return (
    <nav
      className={`hidden md:flex flex-col h-dvh bg-surface border-r border-border-light shrink-0 transition-[width] duration-200 ${collapsed ? "w-[52px]" : "w-[200px]"}`}
    >
      {/* Logo */}
      <button
        onClick={() => setView("list")}
        className={`flex items-center gap-2.5 px-3.5 h-12 shrink-0 hover:bg-surface-raised transition-colors ${collapsed ? "justify-center" : ""}`}
        title="Home"
      >
        <Logo size={22} className="text-accent shrink-0" />
        {!collapsed && (
          <span className="text-[15px] font-extrabold tracking-[-0.03em] text-accent">
            {getBrand().short}
          </span>
        )}
      </button>

      {/* Divider */}
      <div className="mx-2.5 border-t border-border-light" />

      {/* Nav items */}
      <div className="flex flex-col gap-0.5 mt-2 px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isRoute = "view" in item;
          const active = isRoute && view === item.view;
          const onClick = isRoute ? () => setView(item.view) : item.action;
          return (
            <button
              key={item.label}
              onClick={onClick}
              title={collapsed ? item.label : undefined}
              className={`flex items-center gap-2.5 rounded-lg transition-colors h-9 ${collapsed ? "justify-center px-0" : "px-2.5"} ${active ? "text-accent bg-accent-light" : "text-text-secondary hover:text-text hover:bg-surface-raised"}`}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && (
                <span className="text-[14px] font-medium">{item.label}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom section */}
      <div className="flex flex-col gap-0.5 px-2 mb-2">
        {/* Divider */}
        <div className="mx-0.5 mb-1 border-t border-border-light" />

        {/* Inbox */}
        <InboxBell collapsed={collapsed} />

        {/* Settings */}
        <button
          onClick={() => setView("settings")}
          title={collapsed ? "Settings" : undefined}
          className={`flex items-center gap-2.5 rounded-lg transition-colors h-9 ${collapsed ? "justify-center px-0" : "px-2.5"} ${view === "settings" ? "text-accent bg-accent-light" : "text-text-secondary hover:text-text hover:bg-surface-raised"}`}
        >
          <Settings size={18} className="shrink-0" />
          {!collapsed && (
            <span className="text-[14px] font-medium">Settings</span>
          )}
        </button>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`flex items-center gap-2.5 rounded-lg transition-colors h-9 text-text-secondary hover:text-text hover:bg-surface-raised ${collapsed ? "justify-center px-0" : "px-2.5"}`}
        >
          {collapsed ? (
            <PanelLeftOpen size={18} className="shrink-0" />
          ) : (
            <PanelLeftClose size={18} className="shrink-0" />
          )}
          {!collapsed && (
            <span className="text-[14px] font-medium">Collapse</span>
          )}
        </button>
      </div>
    </nav>
  );
}
