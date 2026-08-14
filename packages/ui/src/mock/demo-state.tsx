import { createContext, type ReactNode, useContext, useState } from "react";

import { cn } from "@/lib/utils";

import { protoNavigate } from "./proto-navigate.js";

export type DemoState =
  | "empty"
  | "active-blockers"
  | "just-cleared"
  | "no-blockers";

interface DemoStateCtx {
  state: DemoState;
  setState: (s: DemoState) => void;
  showWelcome: boolean;
  setShowWelcome: (v: boolean) => void;
}

const Ctx = createContext<DemoStateCtx>({
  state: "active-blockers",
  setState: () => {},
  showWelcome: false,
  setShowWelcome: () => {},
});

export function DemoStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState>("empty");
  const [showWelcome, setShowWelcome] = useState(false);
  return (
    <Ctx.Provider value={{ state, setState, showWelcome, setShowWelcome }}>
      {children}
    </Ctx.Provider>
  );
}

export function useDemoState() {
  return useContext(Ctx);
}

export function DemoStrip() {
  const { state, setState, setShowWelcome } = useDemoState();
  const options: { value: DemoState; label: string }[] = [
    { value: "empty", label: "Empty" },
    { value: "active-blockers", label: "Populated" },
    { value: "just-cleared", label: "Cleared" },
    { value: "no-blockers", label: "None" },
  ];

  const pathname = window.location.pathname;
  const onAssetPage =
    pathname === "/compare" ||
    pathname === "/consistency" ||
    pathname === "/wiki-onboard" ||
    pathname === "/experiment-onboard";

  return (
    <div className="flex items-center gap-1 border-b border-border px-4 py-2">
      <span className="text-[14px] text-muted-foreground mr-2">State:</span>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => {
            setState(opt.value);
            if (onAssetPage) protoNavigate("/");
          }}
          className={cn(
            "px-3 py-1 rounded-full text-[14px] transition-colors",
            state === opt.value && !onAssetPage
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
          )}
        >
          {opt.label}
        </button>
      ))}

      <div className="flex-1" />
      <a
        href="/compare"
        className={cn(
          "px-3 py-1 rounded-full text-[14px] transition-colors",
          pathname === "/compare"
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
        )}
      >
        Components
      </a>
      <a
        href="/consistency"
        className={cn(
          "px-3 py-1 rounded-full text-[14px] transition-colors",
          pathname === "/consistency"
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
        )}
      >
        Consistency
      </a>
      <a
        href="/wiki-onboard"
        className={cn(
          "px-3 py-1 rounded-full text-[14px] transition-colors",
          pathname === "/wiki-onboard"
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
        )}
      >
        Wiki Onboard
      </a>
      <a
        href="/experiment-onboard"
        className={cn(
          "px-3 py-1 rounded-full text-[14px] transition-colors",
          pathname === "/experiment-onboard"
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
        )}
      >
        Experiment Onboard
      </a>
    </div>
  );
}
