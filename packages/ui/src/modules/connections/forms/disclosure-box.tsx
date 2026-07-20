import { ChevronDown, ChevronRight } from "@carbon/icons-react";
import { type ReactNode, useState } from "react";

import { cn } from "@/lib/utils";

interface Props {
  title: string;
  defaultOpen?: boolean;
  bodyClassName?: string;
  testId?: string;
  children: ReactNode;
}

export function DisclosureBox({
  title,
  defaultOpen = false,
  bodyClassName,
  testId,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid={testId}
        className="flex h-[44px] w-full items-center gap-2 px-4 text-[14px] font-medium text-foreground"
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
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
