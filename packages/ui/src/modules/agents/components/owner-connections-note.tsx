import { cn } from "@/lib/utils";

import { useOwnerConnectionsLine } from "../hooks/use-owner-connections-line.js";
import { ConnectionNamesTooltip } from "./connection-names-tooltip.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The line on an approval in a Shared Agent's chat
 * that tells an Agent Editor the action runs with the owner's connections,
 * and the account each acts as. The owner never sees it. When the names are
 * cut short, a tooltip lists them all.
 */
export function OwnerConnectionsNote({
  agentId,
  className,
}: {
  agentId: string | null;
  className?: string;
}) {
  const line = useOwnerConnectionsLine(agentId);
  if (!line) return null;
  return (
    <ConnectionNamesTooltip connections={line}>
      <p
        data-testid="approval-owner-connections"
        tabIndex={line.more > 0 ? 0 : undefined}
        className={cn("text-xs text-muted-foreground break-words", className)}
      >
        {line.text}
      </p>
    </ConnectionNamesTooltip>
  );
}
