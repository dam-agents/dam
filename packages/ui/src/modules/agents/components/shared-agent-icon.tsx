import { UserMultiple } from "@carbon/icons-react";

import { Tooltip } from "@/components/ui/tooltip";

import { editorsTooltip } from "../lib/agent-editors.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The mark on the owner's sidebar row of a Shared
 * Agent. Hovering it names the Agent Editors, so the owner always sees who
 * else has access; clicking it opens the agent's People section, where the
 * owner changes the list. It sits inside the row's own button, so it is an
 * image with a label, not a second button.
 */
export function SharedAgentIcon({
  editors,
  onOpen,
}: {
  editors: readonly string[];
  onOpen: () => void;
}) {
  const tooltip = editorsTooltip(editors);
  return (
    <Tooltip
      side="right"
      content={
        <>
          <span className="block font-medium">{tooltip.title}</span>
          {tooltip.shown.map((email) => (
            <span key={email} className="block text-muted-foreground">
              {email}
            </span>
          ))}
          {tooltip.more > 0 && (
            <span className="block text-muted-foreground">
              + {tooltip.more} more
            </span>
          )}
        </>
      }
    >
      <span
        role="img"
        aria-label={tooltip.title}
        data-testid="sidebar-agent-shared"
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
        className="flex size-3.5 shrink-0 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground"
      >
        <UserMultiple size={14} aria-hidden />
      </span>
    </Tooltip>
  );
}
