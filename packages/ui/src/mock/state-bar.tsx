import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import {
  resetCharacterUnlocks,
  unlockAllCharacters,
} from "../modules/agents/lib/character-unlocks.js";
import { queryClient } from "../query-client.js";
import { useStore } from "../store.js";
import { agents } from "./data/agents.js";
import { channelsAvailable } from "./data/channels.js";
import { setMockEmpty } from "./handlers.js";

type UserMode = "first-time" | "returning";

export function MockStateBar() {
  const [userMode, setUserMode] = useState<UserMode>("returning");
  const setView = useStore((s) => s.setView);

  useEffect(() => {
    unlockAllCharacters();
    setView("avatar-sheet");
  }, [setView]);

  const applyMode = (mode: UserMode) => {
    setUserMode(mode);
    if (mode === "first-time") {
      setMockEmpty(true);
      queryClient.setQueryData(["agents", "list-with-channels"], {
        list: [],
        availableChannels: [],
      });
      queryClient.invalidateQueries();
      resetCharacterUnlocks();
      setView("getting-started-sheet");
    } else {
      setMockEmpty(false);
      queryClient.setQueryData(["agents", "list-with-channels"], {
        list: agents,
        availableChannels: channelsAvailable,
      });
      queryClient.invalidateQueries();
      unlockAllCharacters();
      setView("avatar-sheet");
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex items-center gap-2">
      <div className="flex h-10 items-center gap-0.5 rounded-full border border-border bg-card px-1 shadow-lg">
        <button
          type="button"
          onClick={() => applyMode("first-time")}
          className={cn(
            "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
            userMode === "first-time"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          First time
        </button>
        <button
          type="button"
          onClick={() => applyMode("returning")}
          className={cn(
            "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
            userMode === "returning"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Returning
        </button>
      </div>
    </div>
  );
}
