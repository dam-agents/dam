import { useState } from "react";

import { useStore } from "../store.js";

interface ChangeEntry {
  label: string;
  description: string;
  action: () => void;
}

export function ChangeIndex() {
  const [open, setOpen] = useState(false);
  const setView = useStore((s) => s.setView);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);

  const entries: ChangeEntry[] = [
    {
      label: "Agent Cards — Slack Discovery",
      description:
        "New card design with Slack channel indicators. Toggle compares new vs current.",
      action: () => setView("slack-cards-preview"),
    },
    {
      label: "Experiment Setup (primary flow)",
      description:
        "Destination section (platform/Slack/Telegram). On create → chat page + bind modal. Try selecting Slack, Telegram, or both.",
      action: () => setView("experiment-new"),
    },
    {
      label: "Coding Agent Setup",
      description:
        "Same destination fork + post-create modal as experiment setup.",
      action: () => setView("coding-agent-new"),
    },
    {
      label: "Knowledge Base Setup",
      description:
        "Same destination fork + post-create modal as experiment setup.",
      action: () => setView("knowledge-base-new"),
    },
    {
      label: "Home View",
      description: "Landing page — check for any Slack-related changes.",
      action: () => setView("home"),
    },
  ];

  return (
    <div className="fixed right-6 bottom-6 z-toast flex flex-col items-end gap-2">
      {open && (
        <div className="w-80 rounded-lg border border-border bg-background shadow-xl">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">
              Change Index
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              All modified views in this branch
            </p>
          </div>
          <ul className="flex flex-col py-1">
            {entries.map((entry) => (
              <li key={entry.label}>
                <button
                  type="button"
                  onClick={() => {
                    entry.action();
                    setOpen(false);
                  }}
                  className="w-full px-4 py-2.5 text-left transition-colors hover:bg-muted/60"
                >
                  <span className="block text-sm font-medium text-foreground">
                    {entry.label}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {entry.description}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-border px-4 py-2.5">
            <p className="text-sm text-muted-foreground">
              Branch:{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-sm">
                design/home-prototype
              </code>
            </p>
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg transition-transform hover:scale-105 active:scale-95"
      >
        <svg
          width={16}
          height={16}
          viewBox="0 0 16 16"
          fill="none"
          className="shrink-0"
        >
          <path
            d="M2 4h12M2 8h12M2 12h8"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        </svg>
        {open ? "Close index" : "Review changes"}
      </button>
    </div>
  );
}
