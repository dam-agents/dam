import { Add } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";

/**
 * UNIT_BOUNDARY_DESCRIPTION: a section's text-only heading with the one act
 * that belongs to it, a right-aligned add button that creates a new item of
 * what the section lists, and an optional line of copy under it.
 */
export function SectionHeading({
  label,
  addLabel,
  onAdd,
  description,
  children,
}: {
  label: string;
  addLabel?: string;
  onAdd?: () => void;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <SectionLabel className="min-w-0 flex-1">{label}</SectionLabel>
        {onAdd && addLabel && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={addLabel}
            tooltip={addLabel}
            data-testid={`section-add-${label.toLowerCase().replace(/\s+/g, "-")}`}
            onClick={onAdd}
          >
            <Add size={16} />
          </Button>
        )}
        {children}
      </div>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
