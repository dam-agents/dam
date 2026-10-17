import { type ReactNode, useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const CLOSE_MS = 250;

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

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (prefersReducedMotion()) {
      setMounted(false);
      return;
    }
    const timer = setTimeout(() => setMounted(false), CLOSE_MS);
    return () => clearTimeout(timer);
  }, [open]);

  if (!open && !mounted) return null;
  return (
    <div
      inert={!open}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && !open) setMounted(false);
      }}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
        open
          ? "grid-rows-[1fr] opacity-100 starting:grid-rows-[0fr] starting:opacity-0"
          : "grid-rows-[0fr] opacity-0",
        className,
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
