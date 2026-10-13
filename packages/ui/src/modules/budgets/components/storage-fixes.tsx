import { Button } from "@/components/ui/button";

import type { AgentView } from "../../../types.js";
import { type AgentShare, formatBytes } from "../lib/pools.js";

interface Props {
  largest: readonly AgentShare[];
  critical: boolean;
  onDelete: (agent: AgentView) => void;
}

export function StorageFixes({ largest, critical, onDelete }: Props) {
  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted/50 p-3 text-sm">
      <p className="text-foreground">
        {critical
          ? "New agents can't be created until storage is under 90%."
          : "Your storage is getting full."}{" "}
        Delete an agent you no longer need, or clear caches inside your agents,
        such as package caches and build output.
      </p>
      {largest.map(({ agent, bytes }) => (
        <div key={agent.id} className="flex items-center justify-between gap-3">
          <span className="truncate text-muted-foreground">
            {agent.name} · {formatBytes(bytes)}
          </span>
          <Button variant="outline" size="sm" onClick={() => onDelete(agent)}>
            Delete
          </Button>
        </div>
      ))}
    </div>
  );
}
