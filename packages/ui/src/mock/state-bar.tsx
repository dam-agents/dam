import { ListChecked } from "@carbon/icons-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { useStore } from "../store.js";

export function MockStateBar() {
  const [indexOpen, setIndexOpen] = useState(false);
  const setView = useStore((s) => s.setView);
  const view = useStore((s) => s.view);

  return (
    <>
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
          </div>
          <div className="flex flex-col gap-0.5 p-2">
            <button
              type="button"
              onClick={() => setView("agents")}
              className={cn(
                "rounded-md px-3 py-2 text-left transition-colors",
                view === "agents" ? "bg-muted" : "hover:bg-muted/50",
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-block size-1.5 rounded-full",
                    view === "agents" ? "bg-foreground" : "bg-border",
                  )}
                />
                <span className="text-sm font-medium text-foreground">
                  Home
                </span>
              </span>
              <p className="mt-0.5 pl-3.5 text-sm leading-snug text-muted-foreground">
                Agent cards with bee avatars.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setView("avatar-sheet")}
              className={cn(
                "rounded-md px-3 py-2 text-left transition-colors",
                view === "avatar-sheet" ? "bg-muted" : "hover:bg-muted/50",
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-block size-1.5 rounded-full",
                    view === "avatar-sheet" ? "bg-foreground" : "bg-border",
                  )}
                />
                <span className="text-sm font-medium text-foreground">
                  Avatar design sheet
                </span>
              </span>
              <p className="mt-0.5 pl-3.5 text-sm leading-snug text-muted-foreground">
                Bee icons, animations, sleeping states.
              </p>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
