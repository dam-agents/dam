import { TextFont, Warning } from "@carbon/icons-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { fireApprovalToast } from "../modules/notifications/hooks/use-approval-toasts.js";
import { useStore } from "../store.js";

const TOAST_AGENTS = [
  "CI Pipeline Agent",
  "Code Review Agent",
  "Security Scanner",
  "Build Agent",
  "Docs Sync Agent",
];

const IN_FRAME = window.self !== window.top;

export function MockStateBar() {
  if (IN_FRAME) return null;
  return <MockStateBarPanel />;
}

function MockStateBarPanel() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const openApprovals = useStore((s) => s.openApprovals);

  return (
    <>
      <button
        type="button"
        onClick={() => setView("placeholder-texts")}
        className={cn(
          "fixed bottom-4 left-[72px] z-[9999] flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-colors hover:bg-muted",
          view === "placeholder-texts" && "bg-muted",
        )}
        aria-label="Placeholder texts"
      >
        <TextFont size={16} className="text-foreground" />
      </button>

      <button
        type="button"
        onClick={() => {
          const name =
            TOAST_AGENTS[Math.floor(Math.random() * TOAST_AGENTS.length)]!;
          const headlines = [
            "Wants to access network",
            "Wants to run a command",
          ];
          const headline =
            headlines[Math.floor(Math.random() * headlines.length)]!;
          fireApprovalToast(name, headline, openApprovals);
        }}
        className="fixed bottom-4 left-[120px] z-[9999] flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-colors hover:bg-muted"
        aria-label="Fire approval toast"
      >
        <Warning size={16} className="text-foreground" />
      </button>
    </>
  );
}
