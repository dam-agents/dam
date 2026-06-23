import { cva } from "class-variance-authority";

/**
 * Shared styling for the dropdown-menu and context-menu primitives. They wrap
 * different Radix packages (trigger-anchored vs pointer-anchored) but render an
 * identical-looking menu, so the surface styling lives here once.
 */
export const menuContentClassName =
  "z-50 min-w-[160px] rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95";

export const menuSeparatorClassName = "my-1 h-px bg-border";

export const menuItemVariants = cva(
  "flex h-9 w-full cursor-pointer select-none items-center gap-2 rounded-md px-3 text-[14px] outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
  {
    variants: {
      tone: {
        default:
          "data-[highlighted]:bg-muted data-[highlighted]:text-foreground",
        danger:
          "data-[highlighted]:bg-danger-light data-[highlighted]:text-danger text-danger",
      },
    },
    defaultVariants: { tone: "default" },
  },
);
