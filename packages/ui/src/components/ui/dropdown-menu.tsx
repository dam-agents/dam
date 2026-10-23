import { Checkmark } from "@carbon/icons-react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { VariantProps } from "class-variance-authority";
import * as React from "react";

import {
  menuContentClassName,
  menuItemVariants,
  menuSeparatorClassName,
} from "@/components/ui/menu-styles";
import { cn } from "@/lib/utils";

const DropdownMenu = DropdownMenuPrimitive.Root;

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

const MENU_ITEM = '[role^="menuitem"]';

/**
 * UNIT_BOUNDARY_DESCRIPTION: the visible height of a menu that overflows, taken
 * as the start of the row the space Radix reports cuts plus half that row, so the
 * cut row itself is the cue that the list continues. A menu whose rows all fit
 * keeps its full height, and a menu with no cut row gets no cap.
 * The rows come in with their own heights because they differ: a Mode row has
 * two lines, a plain row one.
 */
export function halfRowHeight(
  content: { available: number; height: number },
  rows: readonly { top: number; height: number }[],
): number | null {
  if (content.height <= content.available) return null;
  if (!rows.some((row) => row.top + row.height > content.available))
    return null;
  const cut = rows
    .filter((row) => row.top + row.height / 2 <= content.available)
    .pop();
  return cut ? Math.round(cut.top + cut.height / 2) : null;
}

function availableHeight(el: HTMLElement): number {
  const reported = Number.parseFloat(
    getComputedStyle(el).getPropertyValue(
      "--radix-dropdown-menu-content-available-height",
    ),
  );
  return Number.isFinite(reported) ? reported : el.clientHeight;
}

function rowsOf(el: HTMLElement) {
  const box = el.getBoundingClientRect();
  return [...el.querySelectorAll<HTMLElement>(MENU_ITEM)].map((row) => {
    const rect = row.getBoundingClientRect();
    return { top: rect.top - box.top + el.scrollTop, height: rect.height };
  });
}

function DropdownMenuContent({
  className,
  align = "end",
  sideOffset = 4,
  children,
  style,
  ref,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  const [el, setEl] = React.useState<HTMLDivElement | null>(null);
  const [maxHeight, setMaxHeight] = React.useState<number | null>(null);
  const setNode = React.useCallback(
    (node: HTMLDivElement | null) => {
      setEl(node);
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  React.useEffect(() => {
    if (!el) return;
    const sync = () =>
      setMaxHeight(
        halfRowHeight(
          { available: availableHeight(el), height: el.scrollHeight },
          rowsOf(el),
        ),
      );
    sync();
    const resize = new ResizeObserver(sync);
    resize.observe(el);
    const added = new MutationObserver(sync);
    added.observe(el, { childList: true, subtree: true });
    window.addEventListener("resize", sync);
    return () => {
      resize.disconnect();
      added.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [el]);

  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={setNode}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        style={{
          ...style,
          ...(maxHeight !== null && {
            maxHeight: `min(${maxHeight}px, var(--radix-dropdown-menu-content-available-height))`,
          }),
        }}
        className={cn(
          menuContentClassName,
          "max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto overflow-x-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
          className,
        )}
        {...props}
      >
        {children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({
  className,
  tone,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> &
  VariantProps<typeof menuItemVariants>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(menuItemVariants({ tone }), className)}
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn(
        menuItemVariants({ tone: "default" }),
        "group relative pl-8",
        className,
      )}
      {...props}
    >
      {}
      <span className="absolute left-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary group-data-[state=checked]:bg-primary group-data-[state=checked]:text-primary-foreground">
        <DropdownMenuPrimitive.ItemIndicator className="flex items-center justify-center text-current">
          <Checkmark className="h-4 w-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      className={cn(
        menuItemVariants({ tone: "default" }),
        "relative pl-8",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center rounded-full border border-primary">
        <DropdownMenuPrimitive.ItemIndicator className="size-2 rounded-full bg-primary" />
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

function DropdownMenuSwitchItem({
  className,
  children,
  checked,
  ...props
}: Omit<
  React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>,
  "checked"
> & { checked: boolean }) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      checked={checked}
      className={cn(
        menuItemVariants({ tone: "default" }),
        "group h-auto items-start justify-between gap-4 py-2",
        className,
      )}
      {...props}
    >
      {children}
      <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-xs text-muted-foreground">
        <span aria-hidden>{checked ? "On" : "Off"}</span>
        <span
          aria-hidden
          className="relative inline-flex h-4 w-7 items-center rounded-full bg-input transition-colors group-data-[state=checked]:bg-primary"
        >
          <span className="inline-block h-3 w-3 translate-x-0.5 rounded-full bg-background shadow-sm transition-transform group-data-[state=checked]:translate-x-3.5" />
        </span>
      </span>
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn(
        "px-2 pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn(menuSeparatorClassName, className)}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSwitchItem,
  DropdownMenuTrigger,
};
