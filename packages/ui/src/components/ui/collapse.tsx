import { type ReactNode, useEffect, useState } from "react";

import { cn } from "@/lib/utils";

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Collapse({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!open) {
      setExpanded(false);
      if (prefersReducedMotion()) setMounted(false);
      return;
    }
    setMounted(true);
    const frame = requestAnimationFrame(() => setExpanded(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  if (!mounted) return null;
  return (
    <div
      inert={!open}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && !open) setMounted(false);
      }}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
        expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        className,
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
