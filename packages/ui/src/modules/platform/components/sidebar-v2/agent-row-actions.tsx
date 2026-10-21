import { Add, Tools, TrashCan } from "@carbon/icons-react";

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { FOCUS_RING } from "@/components/ui/focus-ring";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useStore } from "../../../../store.js";
import type { AgentView } from "../../../../types.js";
import { useDeleteAgent } from "../../../agents/api/mutations.js";
import { useConfirmDeleteAgent } from "../../../agents/hooks/use-confirm-delete-agent.js";
import { ActivityFilterMenu } from "../../../home/components/activity-filter-menu.js";
import { defaultActivityFilters } from "../../../home/lib/activity-filter.js";
import { useStartSession } from "../../../sessions/hooks/use-start-session.js";
import {
  setAgentSessionFilter,
  useAgentSessionFilter,
} from "../../../sessions/lib/agent-session-filters.js";
import { REVEAL } from "../../lib/sidebar-tree.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: An Agent's session filter, its New session button and its "⋯" actions menu, which its row in the tree shows on hover or keyboard focus and its popover in the collapsed sidebar's rail shows at all times.
 */
export function AgentRowActions({
  agent,
  current,
  newSessionCurrent = false,
  onNavigate,
  revealedOnHover = true,
}: {
  agent: AgentView;
  current: boolean;
  newSessionCurrent?: boolean;
  onNavigate?: (() => void) | undefined;
  revealedOnHover?: boolean;
}) {
  const startSession = useStartSession();
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const setView = useStore((s) => s.setView);
  const confirmDelete = useConfirmDeleteAgent();
  const deleteAgent = useDeleteAgent();
  const agentFilter = useAgentSessionFilter(agent.id);
  const go = (fn: () => void) => () => {
    fn();
    onNavigate?.();
  };
  return (
    <div className="flex items-center gap-0.5">
      <div
        className={cn(
          "flex items-center",
          revealedOnHover && !agentFilter && REVEAL,
        )}
      >
        <ActivityFilterMenu
          filters={agentFilter ?? defaultActivityFilters()}
          onChange={(next) => setAgentSessionFilter(agent.id, next)}
          name={`Filter sessions of ${agent.name}`}
          testId="sidebar-agent-session-filter"
          className={cn("hover:bg-background", FOCUS_RING)}
        />
      </div>
      <div
        className={cn(
          "flex items-center gap-0.5",
          revealedOnHover && REVEAL,
          revealedOnHover &&
            agentFilter &&
            "hover-capable:w-0 hover-capable:overflow-hidden hover-capable:group-hover/agent:w-auto hover-capable:group-has-[:focus-visible]/agent:w-auto hover-capable:group-has-[[data-state=open]]/agent:w-auto hover-capable:has-[[aria-current=page]]:w-auto",
        )}
      >
        <Tooltip content="New session" side="bottom">
          <button
            type="button"
            aria-label={`New session with ${agent.name}`}
            aria-current={newSessionCurrent ? "page" : undefined}
            data-testid="sidebar-agent-new-session"
            onClick={go(() => startSession(agent.id))}
            className={cn(
              "flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:text-foreground",
              FOCUS_RING,
            )}
          >
            <Add size={16} />
          </button>
        </Tooltip>
        <RowActionsMenu
          label={`${agent.name} actions`}
          testId="sidebar-agent-menu"
          dense
        >
          <DropdownMenuItem
            onSelect={go(() => navigateToSandboxHome(agent.id))}
          >
            <Tools size={14} /> Configure
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            tone="danger"
            onSelect={() =>
              void confirmDelete(agent).then((ok) => {
                if (!ok) return;
                deleteAgent.mutate({ id: agent.id });
                if (current) setView("home");
              })
            }
          >
            <TrashCan size={14} /> Remove
          </DropdownMenuItem>
        </RowActionsMenu>
      </div>
    </div>
  );
}
