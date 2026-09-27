import { Migrate } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

import type { AgentView } from "../../../types.js";
import { useVmRuntime } from "../../features/hooks/use-vm-runtime.js";
import { migrateAction } from "../utils/runtime-migration.js";

interface Props {
  agent: AgentView;
  onMigrate: () => void;
  pending: boolean;
}

export function MigrateRuntimeAction({ agent, onMigrate, pending }: Props) {
  const action = migrateAction(agent, useVmRuntime(), pending);
  if (!action) return null;
  const migrating = action.kind === "migrating";

  return (
    <span onClick={(e) => e.stopPropagation()}>
      <HoverCard>
        <HoverCardTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={migrating}
            className="shrink-0 font-medium text-accent hover:bg-accent-light hover:text-accent-hover"
            onClick={onMigrate}
          >
            <Migrate size={16} />
            {migrating ? "Migrating…" : "Migrate"}
          </Button>
        </HoverCardTrigger>
        <HoverCardContent
          side="top"
          align="end"
          className="flex w-[300px] flex-col gap-2 text-sm"
        >
          <p className="font-bold text-foreground">Move to the new runtime</p>
          <p className="text-muted-foreground">
            The agent restarts on the new sandbox runtime. Its home directory,
            with the workspace and settings, is copied over, and the agent is
            unavailable while the copy runs. This cannot be undone from the UI.
          </p>
          {action.kind === "migrating" && action.message && (
            <p className="rounded-md bg-warning/15 px-2 py-1.5 text-warning-fg">
              {action.message}
            </p>
          )}
        </HoverCardContent>
      </HoverCard>
    </span>
  );
}
