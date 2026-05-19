import { Bot, Settings, Sparkles, Unplug } from "lucide-react";

import { useStore } from "../store.js";

const navItems = [
  { view: "list" as const, label: "Agents", icon: Bot },
  { view: "providers" as const, label: "Providers", icon: Sparkles },
  { view: "connections" as const, label: "Connections", icon: Unplug },
  { view: "settings" as const, label: "Settings", icon: Settings },
] as const;

export function MobileNav() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex items-stretch border-t border-border-light bg-surface/95 backdrop-blur-xl safe-bottom">
      {navItems.map(({ view: v, label, icon: Icon }) => {
        const active = view === v;
        return (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${active ? "text-accent" : "text-text-muted"}`}
          >
            <Icon size={20} />
            <span className="text-[10px] font-semibold">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
