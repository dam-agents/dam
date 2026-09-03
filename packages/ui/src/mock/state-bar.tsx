import { ColorPalette, ListChecked } from "@carbon/icons-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { queryClient } from "../query-client.js";
import { useStore } from "../store.js";
import { setMockEmpty, setMockFirstRun } from "./handlers.js";
import { IconInventory } from "./icon-inventory.js";

interface ReviewScreen {
  label: string;
  note: string;
  go: () => void;
}

function useReviewScreens(): ReviewScreen[] {
  const setView = useStore((s) => s.setView);
  return [
    {
      label: "Home",
      note: "Activity feed, compute, spend.",
      go: () => setView("home"),
    },
    {
      label: "Agents",
      note: "Agent list with status indicators.",
      go: () => setView("agents"),
    },
    {
      label: "Presets",
      note: "Browse presets, detail sheet, search + filter.",
      go: () => setView("packs"),
    },
    {
      label: "Agent setup",
      note: "Create agent form: name, harness, provider, schedule, connections.",
      go: () => setView("agent-new"),
    },
    {
      label: "Setup workbench",
      note: "Iterate on setup section interactions — normal vs preset.",
      go: () => setView("setup-workbench"),
    },
  ];
}

export function MockStateBar() {
  const [mode, setMode] = useState<"populated" | "empty" | "first-run">(
    "populated",
  );
  const [indexOpen, setIndexOpen] = useState(false);
  const [iconInventoryOpen, setIconInventoryOpen] = useState(false);
  const screens = useReviewScreens();
  const view = useStore((s) => s.view);

  const pick = (next: "populated" | "empty" | "first-run") => {
    setMode(next);
    setMockEmpty(next === "empty");
    setMockFirstRun(next === "first-run");
    queryClient.invalidateQueries();
  };

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2">
        <span className="text-sm font-medium text-muted-foreground">
          Preview:
        </span>
        {(["populated", "empty", "first-run"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => pick(m)}
            className={cn(
              "rounded-full px-3 py-1 text-sm font-medium transition-colors",
              mode === m
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            {m === "populated"
              ? "Populated"
              : m === "empty"
                ? "Empty"
                : "First run"}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setIconInventoryOpen(true)}
        className="fixed bottom-4 right-16 z-[9999] flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-colors hover:bg-muted"
        aria-label="Open icon inventory"
      >
        <ColorPalette size={16} className="text-foreground" />
      </button>

      <button
        type="button"
        onClick={() => setIndexOpen((v) => !v)}
        className={cn(
          "fixed bottom-4 right-4 z-[9999] flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-colors hover:bg-muted",
          indexOpen && "bg-muted",
        )}
        aria-label="Toggle review index"
      >
        <ListChecked size={16} className="text-foreground" />
      </button>

      {indexOpen && (
        <div className="fixed bottom-16 right-4 z-[9999] w-72 rounded-lg border border-border bg-card shadow-lg">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-foreground">
              Review index
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Click to navigate. Toggle state above.
            </p>
          </div>
          <div className="flex flex-col gap-0.5 p-2">
            {screens.map((s) => {
              const active =
                (s.label === "Home" && view === "home") ||
                (s.label === "Agents" &&
                  (view === "agents" || view === "agent-new")) ||
                (s.label === "Presets" && view === "packs") ||
                (s.label === "Agent setup" && view === "agent-new") ||
                (s.label === "Setup workbench" && view === "setup-workbench");
              return (
                <button
                  key={s.label}
                  type="button"
                  onClick={s.go}
                  className={cn(
                    "rounded-md px-3 py-2 text-left transition-colors",
                    active ? "bg-muted" : "hover:bg-muted/50",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-block size-1.5 rounded-full",
                        active ? "bg-foreground" : "bg-border",
                      )}
                    />
                    <span className="text-sm font-medium text-foreground">
                      {s.label}
                    </span>
                  </span>
                  <p className="mt-0.5 pl-3.5 text-sm leading-snug text-muted-foreground">
                    {s.note}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {iconInventoryOpen && (
        <IconInventory onClose={() => setIconInventoryOpen(false)} />
      )}
    </>
  );
}
