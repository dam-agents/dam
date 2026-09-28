import { Migrate } from "@carbon/icons-react";
import { type SyntheticEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

import type { AgentView } from "../../../types.js";
import { useVmRuntime } from "../../features/hooks/use-vm-runtime.js";
import { useRuntimeMigrationPlan } from "../api/queries.js";
import { migrateAction } from "../utils/runtime-migration.js";
import { MigrationRefusalList } from "./migration-plan-summary.js";

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

  if (action.kind === "refused") return <RefusedMigrate agentId={agent.id} />;

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
            unavailable while the copy runs. The next step shows exactly what
            moves. This cannot be undone from the UI.
          </p>
        </HoverCardContent>
      </HoverCard>
    </span>
  );
}

// UNIT_BOUNDARY_DESCRIPTION: an agent the api-server would refuse keeps a disabled Migrate. Its reasons card hangs on the wrapper rather than on the disabled button, which takes no pointer events. Hover opens it with a pointer, and a tap, Enter or Space toggles it, because a touch screen never hovers. The card asks for the plan only when it opens, so a list of agents does not fetch a plan per row.
function RefusedMigrate({ agentId }: { agentId: string }) {
  const [open, setOpen] = useState(false);
  const toggle = (e: SyntheticEvent) => {
    e.stopPropagation();
    setOpen((o) => !o);
  };
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <HoverCard open={open} onOpenChange={setOpen}>
        <HoverCardTrigger asChild>
          <span
            role="button"
            tabIndex={0}
            aria-expanded={open}
            aria-label="Why this agent can't migrate"
            data-testid="migrate-refused"
            onClick={toggle}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle(e);
              }
            }}
          >
            <Button
              variant="ghost"
              size="sm"
              disabled
              className="pointer-events-none shrink-0 font-medium"
            >
              <Migrate size={16} />
              Migrate
            </Button>
          </span>
        </HoverCardTrigger>
        <HoverCardContent
          side="top"
          align="end"
          className="flex w-[340px] flex-col gap-2 text-sm"
        >
          <p className="font-bold text-foreground">
            Can't move to the new runtime yet
          </p>
          <RefusalReasons agentId={agentId} />
        </HoverCardContent>
      </HoverCard>
    </span>
  );
}

function RefusalReasons({ agentId }: { agentId: string }) {
  const { data: plan, isError } = useRuntimeMigrationPlan(agentId);
  if (isError)
    return <p className="text-muted-foreground">Couldn't load the reasons.</p>;
  if (!plan) return <p className="text-muted-foreground">Checking…</p>;
  if (!plan.refusal)
    return (
      <p className="text-muted-foreground">
        Nothing stands in the way any more — reload to migrate it.
      </p>
    );
  return (
    <div className="text-muted-foreground">
      <MigrationRefusalList plan={plan} />
    </div>
  );
}
