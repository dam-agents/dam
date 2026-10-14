import { LetterZz } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

import type { AgentView } from "../../../types.js";

export const SLEEP_UNAVAILABLE_REASON =
  "This agent is set to never sleep on its own, so it can't be put to sleep. Change its idle timeout in Sandbox settings.";

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
            Frees its resources. Wakes on any action (a schedule firing, a
            message arriving, or you opening a chat)
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
