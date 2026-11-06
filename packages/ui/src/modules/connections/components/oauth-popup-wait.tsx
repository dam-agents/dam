import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

function remainingOf(deadlineAt: number | null): string | null {
  if (deadlineAt === null) return null;
  const seconds = Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

export function OAuthPopupWait({
  deadlineAt,
  onReopen,
  onDiscard,
}: {
  deadlineAt: number | null;
  onReopen: () => void;
  onDiscard: () => void;
}) {
  const [remaining, setRemaining] = useState(() => remainingOf(deadlineAt));

  useEffect(() => {
    setRemaining(remainingOf(deadlineAt));
    if (deadlineAt === null) return;
    const tick = window.setInterval(
      () => setRemaining(remainingOf(deadlineAt)),
      1000,
    );
    return () => window.clearInterval(tick);
  }, [deadlineAt]);

  return (
    <div className="flex w-full flex-col gap-3" data-testid="oauth-popup-wait">
      <Callout tone="info" size="sm" role="status" aria-live="polite">
        <p className="text-sm text-foreground">
          Waiting for your sign-in to finish in the other window…
          {remaining && (
            <span className="text-muted-foreground">
              {" "}
              {remaining} left.
            </span>
          )}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Can&apos;t find it? Close any sign-in window that is still open, then
          reopen it, so you sign in only once.
        </p>
      </Callout>
      <div className="flex items-center justify-end gap-3">
        <Button
          variant="outline"
          tone="danger"
          onClick={onDiscard}
          data-testid="oauth-popup-discard"
        >
          Cancel and discard
        </Button>
        <Button onClick={onReopen} data-testid="connection-create-submit">
          Reopen window
        </Button>
      </div>
    </div>
  );
}
