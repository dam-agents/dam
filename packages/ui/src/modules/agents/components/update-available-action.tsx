import { Renew } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

import type { AgentView } from "../../../types.js";
import { useReleaseNotesUrl } from "../hooks/use-release-notes-url.js";
import { ReleaseNotesLink } from "./release-notes-link.js";

interface Props {
  agent: AgentView;
  onUpdate: () => void;
  pending: boolean;
  busy: boolean;
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
            className="shrink-0 font-medium text-accent hover:bg-accent-light hover:text-accent-hover"
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
            Latest image version{" "}
            <span className="break-all font-mono text-xs text-foreground">
              {update.toImage}
            </span>
          </p>
          <ReleaseNotesLink href={whatsNew} className="self-start" />
        </HoverCardContent>
      </HoverCard>
    </span>
  );
}
