import { type ReactNode, useId } from "react";

export function HoverTooltip({
  trigger,
  placement = "bottom",
  children,
}: {
  trigger: ReactNode;
  placement?: "bottom" | "right";
  children: ReactNode;
}) {
  const tooltipId = useId();
  const position =
    placement === "right"
      ? "left-full top-1/2 -translate-y-1/2 ml-2"
      : "left-0 top-full mt-2";
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        aria-describedby={tooltipId}
        className="inline-flex rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {trigger}
      </span>
      <span
        id={tooltipId}
        role="tooltip"
        className={`pointer-events-none absolute z-10 w-max max-w-xs rounded-md border-2 border-border bg-surface px-3 py-2 text-[11px] font-normal normal-case tracking-normal leading-relaxed text-text-secondary opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${position}`}
        style={{ boxShadow: "var(--shadow-brutal-sm)" }}
      >
        {children}
      </span>
    </span>
  );
}
