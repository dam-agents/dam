import { Badge } from "@/components/ui/badge";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

import type { AgentView } from "../../../types.js";

export function FreeUpComputeItems({
  agent,
  onPause,
  onStop,
}: {
  agent: AgentView;
  onPause: () => void;
  onStop: () => void;
}) {
  const neverHibernates = agent.hibernationTimeoutMin === 0;
  const pauseUnavailableReason =
    "This agent is set to never hibernate, so pausing it would wake itself. Change its idle timeout in Agent Setup.";
  return (
    <>
      <DropdownMenuLabel>Free up compute</DropdownMenuLabel>
      <DropdownMenuItem
        className="h-auto py-2"
        onSelect={onStop}
        data-testid="agent-stop"
      >
        <MenuItemBody
          title="Stop"
          description="Wakes only when a schedule fires or you start it"
        />
      </DropdownMenuItem>
      <DropdownMenuItem
        className="h-auto py-2 data-[disabled]:pointer-events-auto"
        disabled={neverHibernates}
        onSelect={onPause}
        data-testid="agent-pause"
        title={neverHibernates ? pauseUnavailableReason : undefined}
      >
        <MenuItemBody
          title="Pause"
          tag={neverHibernates ? "Unavailable" : undefined}
          description="Wakes on any action (a schedule firing, a message arriving, or you opening a chat)"
        />
        {neverHibernates && (
          <span className="sr-only">{pauseUnavailableReason}</span>
        )}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  );
}

function MenuItemBody({
  title,
  tag,
  description,
}: {
  title: string;
  tag?: string;
  description: string;
}) {
  return (
    <span className="flex max-w-72 flex-col gap-0.5">
      <span className="flex items-center gap-2">
        {title}
        {tag && (
          <Badge variant="muted" size="sm">
            {tag}
          </Badge>
        )}
      </span>
      <span className="whitespace-normal text-xs text-muted-foreground">
        {description}
      </span>
    </span>
  );
}
