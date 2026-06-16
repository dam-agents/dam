import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

/** Collapsible section used by the Config panel (Schedules, Channels, Skills,
 *  Model). Shared so a conditional section can render its own header only when
 *  it has something to show. */
export function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-1">
      <button
        className="flex items-center gap-2 w-full px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.05em] text-text-muted hover:text-text-secondary transition-colors bg-surface-raised"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
      </button>
      {open && <div className="border-t border-border-light">{children}</div>}
    </div>
  );
}
