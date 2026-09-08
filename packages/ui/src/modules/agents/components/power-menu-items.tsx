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
        className="h-auto py-2"
        disabled={neverHibernates}
        onSelect={onPause}
        data-testid="agent-pause"
      >
        <MenuItemBody
          title="Pause"
          description={
            neverHibernates
              ? "This agent is set to never hibernate, so pausing it would wake itself. Change its idle timeout in Configure agent."
              : "Wakes on any action (a schedule firing, a message arriving, or you opening a chat)"
          }
        />
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  );
}

function MenuItemBody({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <span className="flex max-w-72 flex-col gap-0.5">
      <span>{title}</span>
      <span className="whitespace-normal text-xs text-muted-foreground">
        {description}
      </span>
    </span>
  );
}
