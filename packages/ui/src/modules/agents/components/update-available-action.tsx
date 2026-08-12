import { ArrowRight, Renew } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  useCanHover,
} from "@/components/ui/hover-card";
import { externalLinkProps } from "@/lib/external-link";

import type { AgentView } from "../../../types.js";
import { whatsNewUrl } from "../utils/template-update.js";

interface Props {
  agent: AgentView;
  onUpdate: () => void;
  /** This sandbox's update is in flight. */
  pending: boolean;
}

/**
 * The single entry point for a pending template update (#3137), on the sandbox
 * row and in the sandbox header. Hovering explains what the update is; clicking
 * opens the confirmation that applies it.
 */
export function UpdateAvailableAction({ agent, onUpdate, pending }: Props) {
  const canHover = useCanHover();
  const update = agent.templateUpdate;
  if (!update) return null;
  const whatsNew = whatsNewUrl(update.toImage);

  const button = (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      className="shrink-0 font-medium text-accent hover:bg-accent-light hover:text-accent-hover"
      onClick={onUpdate}
    >
      <Renew size={16} />
      {pending ? "Updating…" : "Update"}
    </Button>
  );
  if (!canHover) return button;

  return (
    <HoverCard>
      <HoverCardTrigger asChild>{button}</HoverCardTrigger>
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
        {whatsNew && (
          <a
            href={whatsNew}
            {...externalLinkProps}
            className="inline-flex items-center gap-1.5 self-start font-medium text-accent hover:underline"
          >
            See what changed <ArrowRight size={16} />
          </a>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
