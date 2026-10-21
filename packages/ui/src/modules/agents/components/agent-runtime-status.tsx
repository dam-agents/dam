import { Badge } from "@/components/ui/badge";

import type { AgentView } from "../../../types.js";
import { migrationTitle } from "../utils/runtime-migration.js";
import { RuntimeMigrationBadge } from "./runtime-migration-badge.js";

// UNIT_BOUNDARY_DESCRIPTION: what an agent's configuration says about where it runs: a container or a VM, and a move between them that an operator started, with its reason as visible text, since a tooltip is out of reach for a keyboard or a screen reader. The move is not the owner's to start, stop or retry, so nothing here controls it. The status region is always mounted so a screen reader announces a move as it starts and ends.
export function AgentRuntimeStatus({
  agent,
}: {
  agent: Pick<AgentView, "vm" | "runtimeMigration">;
}) {
  const migration = agent.runtimeMigration;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="muted" data-testid="agent-runtime-tag">
          {agent.vm ? "Runs in a VM" : "Runs in a container"}
        </Badge>
        <span role="status" className="inline-flex empty:hidden">
          <RuntimeMigrationBadge agent={agent} />
        </span>
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
    </div>
  );
}
