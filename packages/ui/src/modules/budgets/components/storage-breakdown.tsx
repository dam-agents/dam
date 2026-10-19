import type { BudgetVmUsage } from "api-server-api";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { formatBytes, STORAGE_PARTS, storageRows } from "../lib/pools.js";

const PART_HINT: Record<string, string> = {
  [STORAGE_PARTS.seeds]:
    "Copies of agents' files moving onto VM agents. Each copy is deleted when its move finishes or is cancelled; a move that failed keeps its copy until you retry or cancel it.",
  [STORAGE_PARTS.rest]: "Logs and records that keep your VM agents running.",
};

interface Props {
  usage: BudgetVmUsage;
  agents: readonly AgentView[];
}

export function StorageBreakdown({ usage, agents }: Props) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const rows = storageRows(usage, agents);
  return (
    <section
      aria-label="What fills your storage"
      className="flex flex-col gap-2 text-sm"
    >
      <p className="text-muted-foreground">
        Most of your storage is your agents' own files, which are only freed by
        deleting an agent you no longer need or by opening one and asking it to
        delete files it doesn't need.
      </p>
      <ul className="flex flex-col divide-y divide-border">
        {rows.map(({ agent, label, bytes, homeFull }) => (
          <li
            key={agent?.id ?? label}
            className="flex items-baseline justify-between gap-3 py-1.5"
          >
            <span className="min-w-0">
              {agent ? (
                <button
                  type="button"
                  className="cursor-pointer rounded-sm text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => navigateToSandboxHome(agent.id, "setup")}
                >
                  {label}
                </button>
              ) : (
                <span className="text-foreground">{label}</span>
              )}
              <span className="block text-xs text-muted-foreground">
                {agent
                  ? homeFull
                    ? "Out of space, so its writes are failing. Open it to delete files it doesn't need."
                    : "This agent's files. Open it to delete it, or to ask it to clean up."
                  : PART_HINT[label]}
              </span>
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatBytes(bytes)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
