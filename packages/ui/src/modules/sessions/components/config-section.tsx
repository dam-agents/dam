import { useState } from "react";

import { DisclosureToggle } from "@/components/ui/disclosure";

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
        className="w-full px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.05em] text-text-muted hover:text-text-secondary transition-colors bg-surface-raised"
      >
        {title}
        {headerRight && <span className="ml-auto">{headerRight}</span>}
      </DisclosureToggle>
      {open && <div className="border-t border-border-light">{children}</div>}
    </div>
  );
}
