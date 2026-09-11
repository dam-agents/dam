import { ColorPalette, ListChecked } from "@carbon/icons-react";
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
      note: "Agent list or welcome empty state.",
      go: () => setView("home"),
    },
    {
      label: "Starter Kits",
      note: "Browsable starter kit library with spotlight hero.",
      go: () => setView("presets"),
    },
    {
      label: "Agent setup",
      note: "Create agent form: name, harness, provider, schedule, connections.",
      go: () => setView("agent-new"),
    },
    {
      label: "Setup workbench",
      note: "Iterate on setup section interactions — normal vs starter kit.",
      go: () => setView("setup-workbench"),
    },
    {
      label: "Schedule (Setup)",
      note: "Schedule cards in agent creation form.",
      go: () => setView("agent-new"),
    },
    {
      label: "Schedule (Configure)",
      note: "Schedule panel in agent configure tab.",
      go: () => setView("home"),
    },
    {
      label: "Card gallery",
      note: "Agent card design — every state side by side.",
      go: () => setView("card-gallery"),
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
  const realPacks = useStore((s) => s.realPacks);
  const setRealPacks = useStore((s) => s.setRealPacks);

  const pick = (next: "populated" | "empty" | "first-run") => {
    setMode(next);
    setMockEmpty(next === "empty");
    setMockFirstRun(next === "first-run");

    const empty = next === "empty";
    const fresh = next === "first-run";

    queryClient.setQueryData(["agents", "list-with-channels"], {
      list: empty || fresh ? [] : agents,
      availableChannels: fresh ? [] : channelsAvailable,
    });
    queryClient.setQueryData(["approvals", "owner"], fresh ? [] : approvals);

    const trpcKey = (proc: string) => [
      proc.split("."),
      { input: undefined, type: "query" },
    ];
    queryClient.setQueryData(
      trpcKey("connections.list"),
      fresh ? [] : connections,
    );
    queryClient.setQueryData(
      trpcKey("connections.listTemplates"),
      connectionTemplates,
    );
    queryClient.setQueryData(trpcKey("connections.getAgentConnections"), {
      connections: fresh
        ? []
        : agentConnections.map((c) => ({ ...c, connectionId: c.id })),
    });
    queryClient.setQueryData(
      trpcKey("experiments.list"),
      empty || fresh ? [] : experiments,
    );
    queryClient.setQueryData(
      trpcKey("experiments.driverSummaries"),
      empty || fresh ? [] : driverSummaries,
    );
    queryClient.setQueryData(trpcKey("schedules.list"), fresh ? [] : schedules);
    queryClient.setQueryData(
      trpcKey("schedules.listForOwner"),
      fresh ? [] : schedules,
    );
    queryClient.setQueryData(
      trpcKey("knowledgeBases.list"),
      empty || fresh ? [] : knowledgeBases,
    );
    queryClient.setQueryData(
      trpcKey("artifactLibrary.list"),
      empty || fresh ? [] : artifacts,
    );
    queryClient.setQueryData(
      trpcKey("artifactLibrary.listFolders"),
      empty || fresh ? [] : artifactFolders,
    );
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

        <span className="mx-1 h-4 w-px bg-border" />

        <button
          type="button"
          onClick={() => setRealPacks(!realPacks)}
          className={cn(
            "rounded-full px-3 py-1 text-sm font-medium transition-colors",
            realPacks
              ? "bg-preset text-white"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          )}
        >
          Real data
        </button>
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
                (s.label === "Starter Kits" && view === "presets") ||
                (s.label === "Agent setup" && view === "agent-new") ||
                (s.label === "Setup workbench" && view === "setup-workbench") ||
                (s.label === "Schedule (Setup)" && view === "agent-new") ||
                (s.label === "Schedule (Configure)" && view === "home") ||
                (s.label === "Card gallery" && view === "card-gallery");
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
