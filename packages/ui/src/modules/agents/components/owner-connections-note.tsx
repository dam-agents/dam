import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useOwnerConnectionsLine } from "../hooks/use-owner-connections-line.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The line on an approval in a Shared Agent's chat
 * that tells an Agent Editor the action runs with the owner's connections.
 * The owner never sees it. When the names are cut short, a tooltip lists them
 * all.
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
  const text = (
    <p
      data-testid="approval-owner-connections"
      tabIndex={line.more > 0 ? 0 : undefined}
      className={cn("text-xs text-muted-foreground break-words", className)}
    >
      {line.text}
    </p>
  );
  if (line.more === 0) return text;
  return (
    <Tooltip
      side="top"
      content={line.names.map((name) => (
        <span key={name} className="block">
          {name}
        </span>
      ))}
    >
      {text}
    </Tooltip>
  );
}
