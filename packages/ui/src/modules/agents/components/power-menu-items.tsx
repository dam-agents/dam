import { LetterZz } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

import type { AgentView } from "../../../types.js";
import { SLEEP_HINT, SLEEP_UNAVAILABLE_REASON } from "../lib/sleep-copy.js";

export function SleepMenuItem({
  agent,
  onSleep,
}: {
  agent: AgentView;
  onSleep: () => void;
}) {
  const neverSleeps = agent.hibernationTimeoutMin === 0;
  return (
    <>
      <DropdownMenuItem
        className="h-auto py-2 data-[disabled]:pointer-events-auto"
        disabled={neverSleeps}
        onSelect={onSleep}
        data-testid="agent-sleep"
        title={neverSleeps ? SLEEP_UNAVAILABLE_REASON : undefined}
      >
        <LetterZz />
        <span className="flex max-w-72 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            Sleep
            {neverSleeps && (
              <Badge variant="muted" size="sm">
                Unavailable
              </Badge>
            )}
          </span>
          <span className="whitespace-normal text-xs text-muted-foreground">
            {SLEEP_HINT}
          </span>
        </span>
        {neverSleeps && (
          <span className="sr-only">{SLEEP_UNAVAILABLE_REASON}</span>
        )}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  );
}
