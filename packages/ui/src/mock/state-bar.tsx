import { ListChecked } from "@carbon/icons-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { queryClient } from "../query-client.js";
import { useStore } from "../store.js";
import { agents } from "./data/agents.js";
import { approvals } from "./data/approvals.js";
import { artifactFolders, artifacts } from "./data/artifacts.js";
import { channelsAvailable } from "./data/channels.js";
import {
  agentConnections,
  connections,
  connectionTemplates,
} from "./data/connections.js";
import { driverSummaries, experiments } from "./data/experiments.js";
import { knowledgeBases } from "./data/knowledge-bases.js";
import { schedules } from "./data/schedules.js";
import { setMockEmpty, setMockFirstRun } from "./handlers.js";

interface ReviewScreen {
  label: string;
  note: string;
  go: () => void;
}

function flashElement(selector: string, delay = 100) {
  setTimeout(() => {
    const el = document.querySelector(selector);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const ring = document.createElement("div");
    Object.assign(ring.style, {
      position: "absolute",
      inset: "-6px",
      borderRadius: "12px",
      border: "2px solid #6366f1",
      boxShadow: "0 0 0 4px rgba(99,102,241,0.2)",
      pointerEvents: "none",
      zIndex: "9998",
      animation: "review-flash 2s ease-out forwards",
    });
    const parent = el as HTMLElement;
    const prev = parent.style.position;
    if (!prev || prev === "static") parent.style.position = "relative";
    parent.appendChild(ring);
    setTimeout(() => {
      ring.remove();
      if (!prev || prev === "static") parent.style.position = prev;
    }, 2000);
  }, delay);
}

if (!document.getElementById("review-flash-style")) {
  const style = document.createElement("style");
  style.id = "review-flash-style";
  style.textContent = `@keyframes review-flash {
    0% { opacity: 1; }
    70% { opacity: 1; }
    100% { opacity: 0; }
  }`;
  document.head.appendChild(style);
}

function useReviewScreens(): ReviewScreen[] {
  const setView = useStore((s) => s.setView);
  const selectAgent = useStore((s) => s.selectAgent);
  return [
    {
      label: "Home (empty)",
      note: "First-time user — provider prompt CTA.",
      go: () => {
        setMockEmpty(true);
        setMockFirstRun(true);
        queryClient.setQueryData(["agents", "list-with-channels"], {
          list: [],
          availableChannels: [],
        });
        setView("home");
      },
    },
    {
      label: "Home (populated)",
      note: "Returning user with agents.",
      go: () => {
        setMockEmpty(false);
        setMockFirstRun(false);
        queryClient.setQueryData(["agents", "list-with-channels"], {
          list: agents,
          availableChannels: channelsAvailable,
        });
        setView("home");
      },
    },
    {
      label: "Chat",
      note: "Agent chat UI — where user lands after setup.",
      go: () => selectAgent(agents[0]!.id),
    },
    {
      label: "Settings",
      note: "Settings page with providers tab.",
      go: () => useStore.getState().navigateToSettings("providers"),
    },
    {
      label: "Getting Started",
      note: "Onboarding checklist, avatar unlocks, component specs.",
      go: () => setView("getting-started-sheet"),
    },
  ];
}

export function MockStateBar() {
  const [mode, setMode] = useState<"populated" | "empty">("populated");
  const [indexOpen, setIndexOpen] = useState(false);
  const screens = useReviewScreens();
  const view = useStore((s) => s.view);

  const pick = (next: "populated" | "empty") => {
    setMode(next);
    setMockEmpty(next === "empty");
    setMockFirstRun(false);

    const empty = next === "empty";

    queryClient.setQueryData(["agents", "list-with-channels"], {
      list: empty ? [] : agents,
      availableChannels: channelsAvailable,
    });
    queryClient.setQueryData(["approvals", "owner"], approvals);

    const trpcKey = (proc: string) => [
      proc.split("."),
      { input: undefined, type: "query" },
    ];
    queryClient.setQueryData(trpcKey("connections.list"), connections);
    queryClient.setQueryData(
      trpcKey("connections.listTemplates"),
      connectionTemplates,
    );
    queryClient.setQueryData(trpcKey("connections.getAgentConnections"), {
      connections: agentConnections.map((c) => ({
        ...c,
        connectionId: c.id,
      })),
    });
    queryClient.setQueryData(
      trpcKey("experiments.list"),
      empty ? [] : experiments,
    );
    queryClient.setQueryData(
      trpcKey("experiments.driverSummaries"),
      empty ? [] : driverSummaries,
    );
    queryClient.setQueryData(trpcKey("schedules.list"), schedules);
    queryClient.setQueryData(trpcKey("schedules.listForOwner"), schedules);
    queryClient.setQueryData(
      trpcKey("knowledgeBases.list"),
      empty ? [] : knowledgeBases,
    );
    queryClient.setQueryData(
      trpcKey("artifactLibrary.list"),
      empty ? [] : artifacts,
    );
    queryClient.setQueryData(
      trpcKey("artifactLibrary.listFolders"),
      empty ? [] : artifactFolders,
    );
  };

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-2">
        <span className="text-sm font-medium text-muted-foreground">
          Preview:
        </span>
        {(["populated", "empty"] as const).map((m) => (
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
            {m === "populated" ? "Real data" : "Empty"}
          </button>
        ))}
      </div>

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
                (s.label === "Home (empty)" && view === "home") ||
                (s.label === "Home (populated)" && view === "home") ||
                (s.label === "Chat" && view === "chat") ||
                (s.label === "Settings" && view === "settings") ||
                (s.label === "Getting Started" &&
                  view === "getting-started-sheet");
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
    </>
  );
}
