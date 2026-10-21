import { useState } from "react";

import { Badge } from "@/components/ui/badge";

import type { AgentView } from "../../../types.js";
import { migrationTitle } from "../utils/runtime-migration.js";
import { RuntimeMigrationBadge } from "./runtime-migration-badge.js";

export function movedAgentAfter(
  movedAgentId: string | null,
  agent: Pick<AgentView, "id" | "runtimeMigration">,
): string | null {
  return agent.runtimeMigration ? agent.id : movedAgentId;
}

function moveEndedSentence(vm: boolean): string {
  return vm
    ? "The move finished. The agent now runs in a VM."
    : "The move ended. The agent still runs in a container.";
}

// UNIT_BOUNDARY_DESCRIPTION: what an agent's configuration says about where it runs: a container or a VM, and a move between them that an operator started, with its reason as visible text, since a tooltip is out of reach for a keyboard or a screen reader. The move is not the owner's to start, stop or retry, so nothing here controls it. The whole block is one status region that is never hidden, so a screen reader announces a move as it starts and changes phase; a live region does not announce removed text, so once a move this page watched ends, a sentence says how it ended.
export function AgentRuntimeStatus({
  agent,
}: {
  agent: Pick<AgentView, "id" | "vm" | "runtimeMigration">;
}) {
  const [movedAgentId, setMovedAgentId] = useState<string | null>(null);
  const next = movedAgentAfter(movedAgentId, agent);
  if (next !== movedAgentId) setMovedAgentId(next);
  return (
    <AgentRuntimeStatusView
      agent={agent}
      moveEnded={next === agent.id && !agent.runtimeMigration}
    />
  );
}

export function AgentRuntimeStatusView({
  agent,
  moveEnded,
}: {
  agent: Pick<AgentView, "vm" | "runtimeMigration">;
  moveEnded: boolean;
}) {
  const migration = agent.runtimeMigration;
  return (
    <div role="status" className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="muted" data-testid="agent-runtime-tag">
          {agent.vm ? "Runs in a VM" : "Runs in a container"}
        </Badge>
        <RuntimeMigrationBadge agent={agent} hideTitle />
      </div>
      {migration && (
        <p className="text-xs text-muted-foreground">
          {migrationTitle(migration)}
        </p>
      )}
      {migration?.phase === "failed" && (
        <p className="text-xs text-muted-foreground">
          An operator has to finish or undo the move.
        </p>
      )}
      {moveEnded && <p className="sr-only">{moveEndedSentence(agent.vm)}</p>}
    </div>
  );
}
