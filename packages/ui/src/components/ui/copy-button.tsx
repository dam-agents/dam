import { Checkmark, Copy, Warning } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { type CopyState, useCopy } from "@/hooks/use-copy";
import { cn } from "@/lib/utils";

type CopyValue = string | (() => Promise<string | null>);

const ICON = { idle: Copy, copied: Checkmark, failed: Warning } as const;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The icon button that copies a value to the
 * clipboard. It shows a check on success and a warning on failure, names its
 * state in its label and tooltip, and announces it to screen readers, so every
 * copy affordance reports the outcome the same way.
 */
export function CopyButton({
  value,
  label,
  variant = "ghost",
  size = "icon-xs",
  stopPropagation = false,
  onResult,
  className,
}: {
  value: CopyValue;
  label: string;
  variant?: "ghost" | "outline";
  size?: "icon-xs" | "icon-sm";
  stopPropagation?: boolean;
  onResult?: (state: CopyState) => void;
  className?: string;
}) {
  const { copy, state } = useCopy();
  const Icon = ICON[state];
  const shown =
    state === "copied"
      ? "Copied"
      : state === "failed"
        ? "Couldn't copy"
        : label;
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        aria-label={shown}
        tooltip={shown}
        onClick={(e) => {
          if (stopPropagation) e.stopPropagation();
          void copy(value).then(onResult);
        }}
        className={cn(
          "shrink-0 text-muted-foreground hover:text-foreground",
          className,
          state === "copied" && "text-success opacity-100 hover:text-success",
          state === "failed" && "text-danger opacity-100 hover:text-danger",
        )}
      >
        <Icon size={14} />
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {state === "idle" ? "" : shown}
      </span>
    </>
  );
}
