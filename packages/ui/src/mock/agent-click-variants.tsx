import { Bot } from "@carbon/icons-react";
import { useState } from "react";
import { create } from "zustand";

import { cn } from "@/lib/utils";

const STORAGE_KEY = "platform-agent-click-variant";

export const AGENT_CLICK_VARIANTS = [
  { label: "Current", note: "Agent expands to show its sessions" },
  {
    label: "Header swap",
    note: "Activity header becomes ‹ agent name, click to go back",
  },
  {
    label: "Filter chip",
    note: "A removable agent chip appears under Activity",
  },
  {
    label: "Drill in",
    note: "Nav switches to the agent's own view, ‹ All agents to go back",
  },
  { label: "Filter menu", note: "Agent becomes part of the Activity filter" },
  {
    label: "Segmented toggle",
    note: "All | agent toggle above the activity list",
  },
];

function readVariant(): number {
  if (!import.meta.env.VITE_MOCK) return 0;
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    return v >= 0 && v < AGENT_CLICK_VARIANTS.length ? v : 0;
  } catch {
    return 0;
  }
}

export const useAgentClickVariant = create<{
  variant: number;
  setVariant: (v: number) => void;
}>((set) => ({
  variant: readVariant(),
  setVariant: (variant) => {
    try {
      localStorage.setItem(STORAGE_KEY, String(variant));
    } catch {}
    set({ variant });
  },
}));

export function AgentClickVariantPicker() {
  if (!import.meta.env.VITE_MOCK || window.self !== window.top) return null;
  return <AgentClickVariantPanel />;
}

function AgentClickVariantPanel() {
  const variant = useAgentClickVariant((s) => s.variant);
  const setVariant = useAgentClickVariant((s) => s.setVariant);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-4 left-16 z-[9999] flex h-10 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-medium text-background shadow-lg"
      >
        <Bot size={16} />
        Agent click: {variant}. {AGENT_CLICK_VARIANTS[variant]?.label}
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-[9998]"
            onClick={() => setOpen(false)}
          />
          <div className="fixed bottom-16 left-16 z-[9999] flex w-[320px] flex-col gap-0.5 rounded-2xl bg-background p-2 shadow-lg ring-1 ring-black/5">
            <p className="px-3 py-1.5 text-sm font-semibold text-foreground">
              Clicking an agent
            </p>
            {AGENT_CLICK_VARIANTS.map((v, i) => (
              <button
                key={v.label}
                type="button"
                onClick={() => {
                  setVariant(i);
                  setOpen(false);
                }}
                className={cn(
                  "flex flex-col gap-0.5 rounded-xl px-3 py-2 text-left transition-colors",
                  i === variant
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <span className="text-sm font-medium">
                  {i}. {v.label}
                </span>
                <span className="text-sm opacity-80">{v.note}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
