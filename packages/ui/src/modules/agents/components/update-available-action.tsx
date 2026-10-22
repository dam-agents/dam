import { Renew } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

import type { AgentView } from "../../../types.js";
import { useReleaseNotesUrl } from "../hooks/use-release-notes-url.js";
import { ReleaseNotesLink } from "./release-notes-link.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the mark that an Agent has a newer sandbox to move to, drawn beside its name and its actions wherever the reader can reach that Agent.
 */
export function AgentUpdateDot({
  available,
  className,
}: {
  available: boolean;
  className?: string;
}) {
  if (!available) return null;
  return (
    <span
      role="img"
      aria-label="Update available"
      title="Update available"
      data-testid="agent-update-dot"
      className={cn("size-2 shrink-0 rounded-full bg-warning", className)}
    />
  );
}

interface Props {
  agent: AgentView;
  onUpdate: () => void;
  pending: boolean;
  busy?: boolean;
}

export function UpdateAvailableAction({
  agent,
  onUpdate,
  pending,
  busy,
}: Props) {
  const whatsNew = useReleaseNotesUrl(agent.templateId);
  const update = agent.templateUpdate;
  if (!update) return null;

  return (
    <span onClick={(e) => e.stopPropagation()}>
      <HoverCard>
        <HoverCardTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending || busy}
            tone="accent"
            className="shrink-0"
            onClick={onUpdate}
          >
            <Renew size={16} />
            {pending ? "Updating…" : "Update"}
          </Button>
        </HoverCardTrigger>
        <HoverCardContent
          side="top"
          align="end"
          className="flex w-[300px] flex-col gap-2 text-sm"
        >
          <p className="font-bold text-foreground">Update available</p>
          <p className="text-muted-foreground">
            A newer version of agent sandbox is available.
          </p>
          <p className="text-muted-foreground">
            {update.startFailed
              ? "The agent could not start on it, so it stays on its current image."
              : "The agent moves to it by itself once it is idle."}
          </p>
          <ReleaseNotesLink href={whatsNew} className="self-start" />
        </HoverCardContent>
      </HoverCard>
    </span>
  );
}
