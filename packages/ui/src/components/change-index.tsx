import { useState } from "react";

import { AGENT_IDS } from "../mock/data/agents.js";
import { openBindModal } from "../modules/sandboxes/components/channels/bind-modal-state.js";
import { useStore } from "../store.js";

interface ChangeEntry {
  label: string;
  description: string;
  action: () => void;
  group?: string;
}

export function ChangeIndex() {
  const [open, setOpen] = useState(false);
  const setView = useStore((s) => s.setView);
  const selectAgent = useStore((s) => s.selectAgent);

  function openModalPreview(
    channels: ("slack" | "telegram")[],
    opts?: {
      initialSlackView?: "steps" | "id";
      initialKind?: "slack" | "telegram";
    },
  ) {
    selectAgent(AGENT_IDS.cacheTuning);
    openBindModal(channels, opts);
  }

  const entries: ChangeEntry[] = [
    {
      label: "Coding Agent Setup",
      description:
        "Destination section (platform/Slack/Telegram). On create → chat page + bind modal.",
      action: () => setView("coding-agent-new"),
      group: "Views",
    },

    {
      label: "Slack — Bind Steps",
      description:
        "Post-create walkthrough: /invite, /bind, waiting indicator.",
      action: () => openModalPreview(["slack"]),
      group: "Post-Create Modals",
    },
    {
      label: "Slack — Channel ID Form",
      description:
        "Direct channel ID entry with ambient toggle. Click the shortcut link in Steps to get here normally.",
      action: () => openModalPreview(["slack"], { initialSlackView: "id" }),
      group: "Post-Create Modals",
    },
    {
      label: "Telegram — Bind Steps",
      description:
        "Post-create walkthrough: add bot, /bind, pick agent, 10-min expiry.",
      action: () => openModalPreview(["telegram"]),
      group: "Post-Create Modals",
    },
    {
      label: "Both — Slack then Telegram",
      description:
        "Two-step flow: Slack first (step 1/2), then Telegram (step 2/2). Use footer buttons to navigate.",
      action: () => openModalPreview(["slack", "telegram"]),
      group: "Post-Create Modals",
    },
    {
      label: "Both — Telegram Step (direct)",
      description:
        "Jump directly to the Telegram step of the combined flow (step 2/2 with Back button).",
      action: () =>
        openModalPreview(["slack", "telegram"], {
          initialKind: "telegram",
        }),
      group: "Post-Create Modals",
    },
  ];

  const groups = [...new Set(entries.map((e) => e.group))];

  return (
    <div className="fixed right-6 bottom-6 z-toast flex flex-col items-end gap-2">
      {open && (
        <div className="w-80 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-background shadow-xl">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">
              Change Index
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              All modified views in this branch
            </p>
          </div>
          <div className="flex flex-col py-1">
            {groups.map((group) => (
              <div key={group ?? "ungrouped"}>
                {group && (
                  <div className="px-4 pt-3 pb-1">
                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {group}
                    </span>
                  </div>
                )}
                <ul className="flex flex-col">
                  {entries
                    .filter((e) => e.group === group)
                    .map((entry) => (
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
              </div>
            ))}
          </div>
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
