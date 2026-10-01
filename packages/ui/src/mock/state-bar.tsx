import { ListChecked } from "@carbon/icons-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import {
  resetCharacterUnlocks,
  unlockAllCharacters,
} from "../modules/agents/lib/character-unlocks.js";
import { useStore } from "../store.js";

type UserMode = "first-time" | "returning";

export function MockStateBar() {
  const [indexOpen, setIndexOpen] = useState(false);
  const [userMode, setUserMode] = useState<UserMode>("first-time");
  const setView = useStore((s) => s.setView);
  const view = useStore((s) => s.view);

  const applyMode = (mode: UserMode) => {
    setUserMode(mode);
    if (mode === "first-time") {
      resetCharacterUnlocks();
      setView("home");
    } else {
      unlockAllCharacters();
      setView("home");
    }
  };

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

          <div className="border-b border-border px-4 py-3">
            <p className="mb-2 text-sm font-medium text-muted-foreground">
              User mode
            </p>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => applyMode("first-time")}
                className={cn(
                  "flex-1 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                  userMode === "first-time"
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                First time
              </button>
              <button
                type="button"
                onClick={() => applyMode("returning")}
                className={cn(
                  "flex-1 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                  userMode === "returning"
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                Returning
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-0.5 p-2">
            {[
              {
                key: "home" as const,
                label: "Home",
                desc: "Activity feed or welcome empty state.",
              },
              {
                key: "agent-new" as const,
                label: "Create agent",
                desc: "Agent setup with avatar picker.",
              },
              {
                key: "avatar-sheet" as const,
                label: "Avatar design sheet",
                desc: "Robot avatar specs and component reference.",
              },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setView(item.key)}
                className={cn(
                  "rounded-md px-3 py-2 text-left transition-colors",
                  view === item.key ? "bg-muted" : "hover:bg-muted/50",
                )}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-block size-1.5 rounded-full",
                      view === item.key ? "bg-foreground" : "bg-border",
                    )}
                  />
                  <span className="text-sm font-medium text-foreground">
                    {item.label}
                  </span>
                </span>
                <p className="mt-0.5 pl-3.5 text-sm leading-snug text-muted-foreground">
                  {item.desc}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
