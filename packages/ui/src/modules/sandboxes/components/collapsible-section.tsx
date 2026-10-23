import { ChevronRight } from "@carbon/icons-react";
import { type ReactNode, useState } from "react";

interface CollapsibleSectionProps {
  icon: ReactNode;
  title: string;
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

export function CollapsibleSection({
  icon,
  title,
  summary,
  children,
  defaultOpen = false,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-1 py-3.5 text-left transition-colors hover:bg-muted/30"
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
          {icon}
        </div>
        <span className="text-[14px] font-medium text-foreground">{title}</span>
        <span className="ml-auto mr-2 truncate text-[14px] text-muted-foreground">
          {summary}
        </span>
        <ChevronRight
          size={16}
          className={`shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        />
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-200"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="px-1 pb-6 pt-2 pl-12">{children}</div>
        </div>
      </div>
    </div>
  );
}
