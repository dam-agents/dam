import { useState } from "react";

import { cn } from "@/lib/utils";

import { queryClient } from "../query-client.js";
import { useStore } from "../store.js";
import { setMockEmpty } from "./handlers.js";

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
      note: "Empty: welcome + agent type cards. Populated: activity feed.",
      go: () => setView("home"),
    },
    {
      label: "Agents list",
      note: "Empty: agent type cards. Populated: agent rows + Create button.",
      go: () => setView("agents"),
    },
    {
      label: "Agent setup",
      note: "Page 1: name + type. Page 2: type-specific config (image/framework/wiki), provider, connections.",
      go: () => setView("agent-new"),
    },
  ];
}

export function MockStateBar() {
  const [empty, setEmpty] = useState(false);
  const [indexOpen, setIndexOpen] = useState(true);
  const screens = useReviewScreens();
  const view = useStore((s) => s.view);

  const pick = (next: boolean) => {
    setEmpty(next);
    setMockEmpty(next);
    queryClient.invalidateQueries();
  };

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2">
        <span className="text-sm font-medium text-muted-foreground">
          Preview:
        </span>
        <button
          type="button"
          onClick={() => pick(false)}
          className={cn(
            "rounded-full px-3 py-1 text-sm font-medium transition-colors",
            !empty
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          )}
        >
          Populated
        </button>
        <button
          type="button"
          onClick={() => pick(true)}
          className={cn(
            "rounded-full px-3 py-1 text-sm font-medium transition-colors",
            empty
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          )}
        >
          Empty
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setIndexOpen((v) => !v)}
          className="text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          {indexOpen ? "Hide index" : "Review index"}
        </button>
      </div>

      {indexOpen && (
        <div className="fixed right-4 top-14 z-[9999] w-72 rounded-lg border border-border bg-card shadow-lg">
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
                (s.label === "Agents list" && view === "agents") ||
                (s.label === "Agent setup" && view === "agent-new");
              return (
                <button
                  key={s.label}
                  type="button"
                  onClick={s.go}
                  className={cn(
                    "rounded-md px-3 py-2 text-left transition-colors",
                    active
                      ? "bg-muted"
                      : "hover:bg-muted/50",
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
    </>
  );
}
