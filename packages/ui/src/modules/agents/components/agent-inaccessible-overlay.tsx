import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { OverlayFrame } from "./overlay-frame.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Covers the chat surface while the visitor is sent
 * to the agent's Public Agent Page. The redirect is a full navigation started
 * from an effect, and the browser keeps painting this route until it lands, so
 * without this the header, composer and terminal of an agent nobody here can
 * read stay interactive for as long as the navigation takes. The button is the
 * way out if the navigation never lands at all.
 */
export function AgentInaccessibleOverlay({ onLeave }: { onLeave: () => void }) {
  return (
    <OverlayFrame onBack={onLeave}>
      <Spinner size={24} label="Loading" />
      <p className="max-w-105 text-sm text-muted-foreground">
        This agent belongs to someone else. Taking you to its page.
      </p>
      <Button variant="outline" onClick={onLeave}>
        Go to your agents
      </Button>
    </OverlayFrame>
  );
}
