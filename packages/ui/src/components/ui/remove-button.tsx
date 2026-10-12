import { TrashCan } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The trash button that removes one row from a
 * list. One look everywhere: muted at rest, red on hover, with the label as
 * both its accessible name and its tooltip.
 */
export function RemoveButton({
  label,
  onClick,
  disabled,
  className,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      tone="danger"
      size="icon-sm"
      aria-label={label}
      tooltip={label}
      disabled={disabled}
      onClick={onClick}
      className={cn("shrink-0 text-muted-foreground", className)}
    >
      <TrashCan size={16} />
    </Button>
  );
}
