import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import type { ConnectionHolder } from "../hooks/use-connection-holders.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: What a connection's row says on the Connections
 * page, where there is no agent to add it to: how many agents use it, with
 * their names one click away, or that none does.
 */
export function ConnectionUsedBy({
  connectionId,
  agents,
}: {
  connectionId: string;
  agents: readonly ConnectionHolder[];
}) {
  const testId = `connection-used-by-${connectionId}`;
  if (agents.length === 0)
    return (
      <span
        className="inline-flex h-8 shrink-0 items-center text-sm text-muted-foreground"
        data-testid={testId}
      >
        Not used by any agent
      </span>
    );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center rounded-sm text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          data-testid={testId}
        >
          Used by {agents.length} agent{agents.length === 1 ? "" : "s"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-3">
        <ul
          className="flex flex-col gap-1 text-sm text-foreground"
          data-testid={`${testId}-names`}
        >
          {agents.map(({ id, name }) => (
            <li key={id} className="truncate" title={name}>
              {name}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
