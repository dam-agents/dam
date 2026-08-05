import { Locked } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

import { OverlayFrame } from "./overlay-frame.js";

/**
 * Full-view takeover for a chat the signed-in user may not open — the end of the
 * road for a session link followed by someone other than the owner, which is
 * everyone else in the conversation it was posted into.
 *
 * It deliberately says nothing about the target beyond "not yours": the read
 * behind it is owner-scoped, so a sandbox belonging to someone else and one that
 * was deleted are the same answer, and neither reveals whose it is.
 */
export function AgentInaccessibleOverlay({
  onLeave,
}: {
  /** Leave the surface entirely — there is nothing here to wait for. */
  onLeave: () => void;
}) {
  return (
    <OverlayFrame onBack={onLeave}>
      <Locked size={40} className="text-muted-foreground" />
      <h2 className="text-lg font-bold text-foreground">
        This conversation isn&apos;t yours
      </h2>
      <p className="max-w-105 text-sm text-muted-foreground">
        The link points at someone else&apos;s sandbox, or at one that no longer
        exists. A session stays private to the person who owns the sandbox, so
        there is nothing here for you to open — ask its owner to share what you
        need from it.
      </p>
      <Button variant="outline" onClick={onLeave}>
        Go to your sandboxes
      </Button>
    </OverlayFrame>
  );
}
