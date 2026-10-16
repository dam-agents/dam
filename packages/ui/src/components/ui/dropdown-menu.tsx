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

function DropdownMenuContent({
  className,
  align = "end",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          menuContentClassName,
          "max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto overflow-x-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
          className,
        )}
        {...props}
      />
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
