import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import type { VariantProps } from "class-variance-authority";
import * as React from "react";

import {
  menuContentClassName,
  menuItemVariants,
  menuSeparatorClassName,
} from "@/components/ui/menu-styles";
import { cn } from "@/lib/utils";

const ContextMenu = ContextMenuPrimitive.Root;

const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        collisionPadding={8}
        className={cn(menuContentClassName, className)}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuItem({
  className,
  tone,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> &
  VariantProps<typeof menuItemVariants>) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(menuItemVariants({ tone }), className)}
      {...props}
    />
  );
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      className={cn(menuSeparatorClassName, className)}
      {...props}
    />
  );
}

export {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
};
