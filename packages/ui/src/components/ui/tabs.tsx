import { cva } from "class-variance-authority";
import { type KeyboardEvent, type ReactNode, useRef } from "react";

import { cn } from "@/lib/utils";

const tabsList = cva("flex", {
  variants: {
    variant: {
      underline: "gap-4 border-b border-border",
      pill: "gap-1",
    },
    orientation: {
      horizontal: "flex-row items-center",
      vertical: "flex-col",
    },
  },
  defaultVariants: { variant: "underline", orientation: "horizontal" },
});

const tabTrigger = cva(
  "flex items-center gap-2 text-left ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        underline: "-mb-px border-b-2",
        pill: "rounded-lg",
      },
      size: { default: "", sm: "" },
      active: { true: "", false: "" },
    },
    compoundVariants: [
      {
        variant: "underline",
        size: "default",
        className: "px-1 py-3 text-sm",
      },
      { variant: "underline", size: "sm", className: "h-10 px-4 text-sm" },
      { variant: "pill", size: "default", className: "h-11 px-4 text-sm" },
      { variant: "pill", size: "sm", className: "px-3 py-2 text-sm" },
      {
        variant: "underline",
        active: true,
        className: "border-foreground font-medium text-foreground",
      },
      {
        variant: "underline",
        active: false,
        className:
          "border-transparent text-muted-foreground hover:text-foreground",
      },
      {
        variant: "pill",
        active: true,
        className: "bg-muted font-semibold text-foreground",
      },
      {
        variant: "pill",
        active: false,
        className: "text-foreground/80 hover:bg-muted/60 hover:text-foreground",
      },
    ],
    defaultVariants: { size: "default" },
  },
);

export interface TabDef<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  /** Right-aligned slot — a count, a badge. Stretches the trigger full-width. */
  trailing?: ReactNode;
  disabled?: boolean;
  /** `id` of the panel this tab controls. The trigger then carries
   *  `${panelId}-tab`, which the panel points back at with `aria-labelledby`. */
  panelId?: string;
  testId?: string;
}

interface TabsProps<T extends string> {
  tabs: readonly TabDef<T>[];
  /** `null` leaves every tab unselected — for strips whose panel area can show
   *  something outside the tab set. */
  value: T | null;
  onValueChange: (value: T) => void;
  variant?: "underline" | "pill";
  orientation?: "horizontal" | "vertical";
  size?: "default" | "sm";
  /** Names the tab list for assistive tech. */
  ariaLabel: string;
  className?: string;
}

/** Controlled tab strip, triggers only — panels stay wherever the caller
 *  renders them. Hand-rolled rather than built on `@radix-ui/react-tabs`
 *  because that primitive has no unselected state and its orientation can't
 *  vary by breakpoint, both of which call sites here need. */
export function Tabs<T extends string>({
  tabs,
  value,
  onValueChange,
  variant = "underline",
  orientation = "horizontal",
  size = "default",
  ariaLabel,
  className,
}: TabsProps<T>) {
  const triggers = useRef<Map<T, HTMLButtonElement> | null>(null);
  const selectable = tabs
    .filter((tab) => !tab.disabled)
    .map((tab) => tab.value);

  // Exactly one trigger stays in the tab sequence, even when nothing is
  // selected or the selected tab is disabled — otherwise the strip becomes
  // unreachable by keyboard.
  const tabStop =
    value !== null && selectable.includes(value) ? value : selectable[0];

  const select = (next: T | undefined) => {
    if (next === undefined) return;
    onValueChange(next);
    triggers.current?.get(next)?.focus();
  };

  const wrap = (delta: number) => {
    const current = tabStop === undefined ? -1 : selectable.indexOf(tabStop);
    if (current === -1) return selectable[0];
    return selectable[
      (current + delta + selectable.length) % selectable.length
    ];
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const back = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
    const forward = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
    if (event.key === back) select(wrap(-1));
    else if (event.key === forward) select(wrap(1));
    else if (event.key === "Home") select(selectable[0]);
    else if (event.key === "End") select(selectable[selectable.length - 1]);
    else return;
    event.preventDefault();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={orientation}
      className={cn(tabsList({ variant, orientation }), className)}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(node) => {
              triggers.current ??= new Map();
              if (node) triggers.current.set(tab.value, node);
              else triggers.current.delete(tab.value);
            }}
            type="button"
            role="tab"
            id={tab.panelId ? `${tab.panelId}-tab` : undefined}
            aria-selected={active}
            aria-controls={tab.panelId}
            tabIndex={tab.value === tabStop ? 0 : -1}
            disabled={tab.disabled}
            data-testid={tab.testId}
            onClick={() => onValueChange(tab.value)}
            onKeyDown={onKeyDown}
            className={cn(
              tabTrigger({ variant, size, active }),
              tab.trailing && "w-full justify-between",
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.trailing}
          </button>
        );
      })}
    </div>
  );
}
