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

  // UNIT_BOUNDARY_DESCRIPTION: a running migration disables the button, and a disabled button takes no pointer events, so a hover card on it would never open in the one state that has something to report. That state's text rides the button's tooltip instead, which the button shows even while disabled.
  if (action.kind === "migrating") {
    return (
      <span onClick={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="sm"
          disabled
          tooltip={
            action.message ??
            "Copying the home directory to the new sandbox runtime"
          }
          className="shrink-0 font-medium text-accent"
        >
          <Migrate size={16} />
          Migrating…
        </Button>
      </span>
    );
  }

  return (
    <span onClick={(e) => e.stopPropagation()}>
      <HoverCard>
        <HoverCardTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 font-medium text-accent hover:bg-accent-light hover:text-accent-hover"
            onClick={onMigrate}
          >
            <Migrate size={16} />
            Migrate
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
        </HoverCardContent>
      </HoverCard>
    </span>
  );
}
