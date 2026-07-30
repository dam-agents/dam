import { type ReactNode, useState } from "react";

import { Callout } from "@/components/ui/callout";
import { DisclosureToggle } from "@/components/ui/disclosure";
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
  const toggle = () => setOpen((v) => !v);

  if (variant === "section") {
    return (
      <Callout>
        <DisclosureToggle
          open={open}
          onToggle={toggle}
          testId={testId}
          chevronSize={14}
          chevronClassName="text-muted-foreground"
          className="w-full gap-1.5"
        >
          <SectionLabel>{title}</SectionLabel>
        </DisclosureToggle>
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
      <DisclosureToggle
        open={open}
        onToggle={toggle}
        testId={testId}
        className="h-[44px] w-full px-4 text-[14px] font-medium text-foreground"
      >
        {title}
      </DisclosureToggle>
      {open && (
        <div className={cn("border-t border-border px-4 py-4", bodyClassName)}>
          {children}
        </div>
      )}
    </div>
  );
}
