import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { SECTION_COLLAPSE_LIMITS } from "../home-thresholds.js";

const STATE_DOT: Record<string, string> = {
  running: "bg-success",
  hibernated: "bg-muted-foreground",
  error: "bg-danger",
};

const STATE_LABEL: Record<string, string> = {
  running: "Running",
  hibernated: "Hibernated",
  error: "Error",
};

export function AgentsSection({ agents }: { agents: AgentView[] }) {
  const [expanded, setExpanded] = useState(false);

  if (agents.length === 0) return null;

  const limit = SECTION_COLLAPSE_LIMITS.agents;
  const visible = expanded ? agents : agents.slice(0, limit);
  const hasMore = agents.length > limit;

  return (
    <section className="space-y-3" aria-label="Your agents">
      <div className="flex items-center gap-2">
        <h2 className="text-[18px] font-semibold text-foreground">Your agents</h2>
        <span className="text-[14px] text-muted-foreground">{agents.length}</span>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden divide-y divide-border">
        {visible.map((agent) => (
          <AgentRow key={agent.id} agent={agent} />
        ))}
      </div>

      {hasMore && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-[14px] font-medium text-accent hover:text-accent/80 transition-colors"
        >
          Show all {agents.length} agents
        </button>
      )}
      {expanded && hasMore && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-[14px] font-medium text-accent hover:text-accent/80 transition-colors"
        >
          Show fewer
        </button>
      )}
    </section>
  );
}

function AgentRow({ agent }: { agent: AgentView }) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const dotColor = STATE_DOT[agent.state] ?? "bg-muted";
  const stateLabel = STATE_LABEL[agent.state] ?? agent.state;

  const kindLabel =
    agent.kind === "experiment"
      ? "Experiment"
      : agent.kind === "knowledge-base"
        ? "Knowledge Base"
        : null;

  return (
    <button
      type="button"
      onClick={() => navigateToSandboxHome(agent.id)}
      className="flex items-center gap-3 px-4 py-3 w-full text-left hover:bg-muted/60 transition-colors"
    >
      <span className={cn("w-2 h-2 rounded-full shrink-0", dotColor)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium text-foreground truncate">
            {agent.name}
          </span>
          {kindLabel && (
            <Badge variant="muted" size="sm">
              {kindLabel}
            </Badge>
          )}
        </div>
      </div>
      <span className="text-[14px] text-muted-foreground shrink-0">
        {stateLabel}
      </span>
    </button>
  );
}
