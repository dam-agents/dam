import { Locked } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

import { OverlayFrame } from "./overlay-frame.js";

export function AgentInaccessibleOverlay({ onLeave }: { onLeave: () => void }) {
  return (
    <OverlayFrame onBack={onLeave}>
      <Locked size={40} className="text-muted-foreground" />
      <h2 className="text-lg font-bold text-foreground">
        This conversation isn&apos;t yours
      </h2>
      <p className="max-w-105 text-sm text-muted-foreground">
        The link points at someone else&apos;s agent, or at one that no longer
        exists. A session stays private to the person who owns the agent, so
        there is nothing here for you to open — ask its owner to share what you
        need from it.
      </p>
      <Button variant="outline" onClick={onLeave}>
        Go to your agents
      </Button>
    </OverlayFrame>
  );
}
