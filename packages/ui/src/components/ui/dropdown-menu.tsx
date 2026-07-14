import { Checkmark as Check } from "@carbon/icons-react";
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
          "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
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
      {/* Mirrors the shared Checkbox primitive's box styling */}
      <span className="absolute left-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary group-data-[state=checked]:bg-primary group-data-[state=checked]:text-primary-foreground">
        <DropdownMenuPrimitive.ItemIndicator className="flex items-center justify-center text-current">
          <Check className="h-4 w-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
};
