import { ListChecked, Warning } from "@carbon/icons-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { fireApprovalToast } from "../modules/notifications/hooks/use-approval-toasts.js";
import { useStore } from "../store.js";

interface ReviewScreen {
  label: string;
  note: string;
  go: () => void;
}

function useReviewScreens(): ReviewScreen[] {
  const setView = useStore((s) => s.setView);
  const openApprovals = useStore((s) => s.openApprovals);
  const toggleNotifications = useStore((s) => s.toggleNotifications);
  return [
    {
      label: "Home",
      note: "Needs-you banner appears when approvals are pending.",
      go: () => setView("home"),
    },
    {
      label: "Activity feed",
      note: "Global activity — not scoped to an agent. Agent header bar removed.",
      go: toggleNotifications,
    },
    {
      label: "Needs you",
      note: "Approval drill-down in the activity panel.",
      go: openApprovals,
    },
    {
      label: "Activity feed cards",
      note: "Every card state side by side.",
      go: () => setView("card-gallery"),
    },
  ];
}

const TOAST_AGENTS = [
  "CI Pipeline Agent",
  "Code Review Agent",
  "Security Scanner",
  "Build Agent",
  "Docs Sync Agent",
];

export function MockStateBar() {
  const [indexOpen, setIndexOpen] = useState(false);
  const screens = useReviewScreens();
  const view = useStore((s) => s.view);
  const openApprovals = useStore((s) => s.openApprovals);

  return (
    <>
      <button
        type="button"
        onClick={() => setIndexOpen((v) => !v)}
        className={cn(
          "fixed bottom-4 left-4 z-[9999] flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-colors hover:bg-muted",
          indexOpen && "bg-muted",
        )}
        aria-label="Toggle review index"
      >
        <ListChecked size={16} className="text-foreground" />
      </button>

      {indexOpen && (
        <div className="fixed bottom-16 left-4 z-[9999] w-72 rounded-lg border border-border bg-card shadow-lg">
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
                (s.label === "Activity feed cards" &&
                  view === "card-gallery");
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
          <div className="border-t border-border px-2 py-2">
            <button
              type="button"
              onClick={() => {
                const name =
                  TOAST_AGENTS[
                    Math.floor(Math.random() * TOAST_AGENTS.length)
                  ]!;
                const headlines = [
                  "Wants to access network",
                  "Wants to run a command",
                ];
                const headline =
                  headlines[Math.floor(Math.random() * headlines.length)]!;
                fireApprovalToast(name, headline, openApprovals);
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors hover:bg-warning/10"
            >
              <Warning size={16} className="shrink-0 text-warning" />
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-foreground">
                  Fire approval toast
                </span>
                <p className="text-sm text-muted-foreground">
                  Preview the toast notification
                </p>
              </div>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
