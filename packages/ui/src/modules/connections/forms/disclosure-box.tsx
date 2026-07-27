import { ChevronDown, ChevronRight } from "@carbon/icons-react";
import { type ReactNode, useState } from "react";

import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  defaultOpen?: boolean;
  bodyClassName?: string;
  testId?: string;
  /** `box` (default): boxed header with a divider above the body. `section`:
   *  an uppercase form-label header, no divider, with an optional description. */
  variant?: "box" | "section";
  /** `section` only — a muted line under the header (e.g. a docs link). */
  description?: ReactNode;
  children: ReactNode;
}

export function DisclosureBox({
  title,
  defaultOpen = false,
  bodyClassName,
  testId,
  variant = "box",
  description,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const Chevron = open ? ChevronDown : ChevronRight;

  if (variant === "section") {
    return (
      <Callout>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid={testId}
          className="flex w-full items-center gap-1.5 text-left"
        >
          <Chevron size={14} className="text-muted-foreground" />
          <SectionLabel>{title}</SectionLabel>
        </button>
        {description && (
          <div className="mt-1.5 pl-5 text-[13px] text-muted-foreground">
            {description}
          </div>
        )}
        {open && <div className={cn("mt-4", bodyClassName)}>{children}</div>}
      </Callout>
    );
  }

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid={testId}
        className="flex h-[44px] w-full items-center gap-2 px-4 text-[14px] font-medium text-foreground"
      >
        <Chevron size={16} />
        {title}
      </button>
      {open && (
        <div className={cn("border-t border-border px-4 py-4", bodyClassName)}>
          {children}
        </div>
      )}
    </div>
  );
}
