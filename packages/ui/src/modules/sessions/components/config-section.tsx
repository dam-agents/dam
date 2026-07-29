import { useState } from "react";

import { DisclosureToggle } from "@/components/ui/disclosure";
import { labelVariants } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function Section({
  title,
  defaultOpen = true,
  headerRight,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-1">
      <DisclosureToggle
        open={open}
        onToggle={() => setOpen((o) => !o)}
        chevronSize={12}
        className={cn(
          labelVariants(),
          "w-full px-4 py-2.5 transition-colors bg-surface-raised hover:text-text-secondary",
        )}
      >
        {title}
        {headerRight && <span className="ml-auto">{headerRight}</span>}
      </DisclosureToggle>
      {open && <div className="border-t border-border-light">{children}</div>}
    </div>
  );
}
