import { Button } from "@/components/ui/button";

import type { AgentView } from "../../../types.js";
import { type AgentShare, formatBytes } from "../lib/pools.js";

interface Props {
  idle: readonly AgentShare[];
  critical: boolean;
  onPause: (agent: AgentView) => void;
  onStop: (agent: AgentView) => void;
}

const SHOWN = 3;

export function MemoryFixes({ idle, critical, onPause, onStop }: Props) {
  const pausable = idle.filter((s) => s.agent.hibernationTimeoutMin !== 0);
  const freed = pausable.reduce((sum, s) => sum + s.bytes, 0);
  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted/50 p-3 text-sm">
      <p className="text-foreground">
        {idle.length > 0
          ? "Pause agents you are not using to free memory."
          : "None of your agents is idle right now."}
        {critical && " At 90% the platform starts pausing idle agents for you."}
      </p>
      {idle.slice(0, SHOWN).map(({ agent, bytes }) => {
        const alwaysOn = agent.hibernationTimeoutMin === 0;
        return (
          <div
            key={agent.id}
            className="flex items-center justify-between gap-3"
          >
            <span className="truncate text-muted-foreground">
              {agent.name} · {formatBytes(bytes)}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => (alwaysOn ? onStop(agent) : onPause(agent))}
            >
              {alwaysOn ? "Stop" : "Pause"}
            </Button>
          </div>
        );
      })}
      {pausable.length > 1 && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => pausable.forEach((s) => onPause(s.agent))}
        >
          Pause all {pausable.length} idle agents (frees about{" "}
          {formatBytes(freed)})
        </Button>
      )}
    </div>
  );
}
