import { Add, ChevronRight } from "@carbon/icons-react";
import { type ReactNode, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

/**
 * UNIT_BOUNDARY_DESCRIPTION: a section folded to its heading and a count, with
 * the one add button that belongs to it beside the heading, so a panel of
 * several sections stays short until a reader opens the one they want.
 */
export function CollapsibleSection({
  title,
  count,
  addLabel,
  onAdd,
  children,
  defaultOpen = false,
}: {
  title: string;
  count?: number;
  addLabel?: string;
  onAdd?: () => void;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section>
      <div className="mb-2 flex items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((was) => !was)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ChevronRight
            size={16}
            aria-hidden
            className={cn(
              "shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          <SectionLabel>
            {count === undefined ? title : `${title} (${count})`}
          </SectionLabel>
        </button>
        {onAdd && addLabel && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={addLabel}
            tooltip={addLabel}
            data-testid={`section-add-${title.toLowerCase().replace(/\s+/g, "-")}`}
            onClick={onAdd}
          >
            <Add size={16} />
          </Button>
        )}
      </div>
      {open && <div id={id}>{children}</div>}
    </section>
  );
}
