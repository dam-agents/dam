import { useState, useEffect } from "react";
import { useStore } from "../store.js";
import { Logo } from "./logo.js";
import {
  Bot,
  Sparkles,
  Unplug,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { InboxBell } from "../modules/approvals/components/inbox-bell.js";

const STORAGE_KEY = "humr-sidebar-collapsed";

const navItems = [
  { view: "list" as const, label: "Agents", icon: Bot },
  { view: "providers" as const, label: "Providers", icon: Sparkles },
  { view: "connections" as const, label: "Connections", icon: Unplug },
] as const;

export function Sidebar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);

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
            humr
          </span>
        )}
      </button>

      {/* Divider */}
      <div className="mx-2.5 border-t border-border-light" />

      {/* Nav items */}
      <div className="flex flex-col gap-0.5 mt-2 px-2">
        {navItems.map(({ view: v, label, icon: Icon }) => {
          const active = view === v;
          return (
            <button
              key={v}
              onClick={() => setView(v)}
              title={collapsed ? label : undefined}
              className={`flex items-center gap-2.5 rounded-lg transition-colors h-9 ${collapsed ? "justify-center px-0" : "px-2.5"} ${active ? "text-accent bg-accent-light" : "text-text-secondary hover:text-text hover:bg-surface-raised"}`}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && (
                <span className="text-[14px] font-medium">{label}</span>
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
