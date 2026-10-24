import { UserMultiple } from "@carbon/icons-react";
import type { AgentAccess } from "api-server-api";
import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";

import { editorsTooltip } from "../lib/agent-editors.js";

export function SharedBadge(props: ComponentProps<typeof Badge>) {
  return (
    <Badge
      variant="accent"
      className="gap-1"
      data-testid="agent-shared-badge"
      {...props}
    >
      <UserMultiple size={12} />
      Shared
    </Badge>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Shared badge in a Shared Agent's chat, for
 * its owner and its Agent Editors alike. Its tooltip names the editors, and
 * for an editor the owner too, so everyone in the chat knows who else works
 * on the agent.
 */
export function SharedAgentBadge({ access }: { access: AgentAccess }) {
  const tooltip = editorsTooltip(access.editors);
  return (
    <Tooltip
      side="bottom"
      content={
        <>
          {access.role === "editor" && (
            <span className="block text-muted-foreground">
              Owner: {access.ownerEmail ?? "a former user"}
            </span>
          )}
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
      <SharedBadge tabIndex={0} aria-label={tooltip.title} />
    </Tooltip>
  );
}
