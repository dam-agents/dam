import { cn } from "@/lib/utils";

import { armColor } from "../lib/arm-color.js";

/** Overlapping color dots, one per arm — a glance-level identity for the
 *  experiment's competitors on the list row. */
export function ArmSwatches({ agentIds }: { agentIds: string[] }) {
  if (agentIds.length === 0) return null;
  return (
    <span className="inline-flex" aria-hidden>
      {agentIds.map((agentId, index) => (
        <span
          key={agentId}
          className={cn(
            "block h-3 w-3 rounded-full ring-2 ring-card",
            index > 0 && "-ml-1",
          )}
          style={{ backgroundColor: armColor(agentId) }}
        />
      ))}
    </span>
  );
}
