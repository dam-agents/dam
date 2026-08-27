import { Close, WarningAlt } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import type { ArtifactBridgeStatus } from "../hooks/use-artifact-bridge.js";
import { progressLabel } from "../lib/artifact-request-status.js";

export function ArtifactRequestStatusBar({
  status,
  onDismissFailure,
  className,
}: {
  status: ArtifactBridgeStatus;
  onDismissFailure: () => void;
  className?: string;
}) {
  const { progress, failure, action } = status;
  if (!progress && !failure) return null;

  return (
    <div
      className={cn(
        "flex shrink-0 items-start gap-2 bg-muted/40 px-4 py-2 text-xs",
        className,
      )}
    >
      {progress ? (
        <>
          <Spinner className="mt-px" />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {progressLabel(progress)}
            {action ? ` (${action})` : ""}
          </span>
        </>
      ) : (
        <>
          <WarningAlt size={16} className="mt-px shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            <span className="text-foreground">{failure?.message}</span>
            {failure?.nextStep && (
              <span className="text-muted-foreground"> {failure.nextStep}</span>
            )}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Dismiss"
            onClick={onDismissFailure}
          >
            <Close size={14} />
          </Button>
        </>
      )}
    </div>
  );
}
