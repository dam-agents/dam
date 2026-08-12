import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import * as React from "react";

import {
  FLOATING_PANEL,
  FloatingPanelTail,
} from "@/components/ui/floating-panel";
import { cn } from "@/lib/utils";

const HoverCardTrigger = HoverCardPrimitive.Trigger;

/** Radix defaults to 700ms, tuned for a card that interrupts reading. This one
 *  annotates a control the user has deliberately pointed at, so it should feel
 *  like a response to that. The close delay is the grace period for crossing
 *  the gap into the card. */
function HoverCard({
  openDelay = 200,
  closeDelay = 200,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return (
    <HoverCardPrimitive.Root
      openDelay={openDelay}
      closeDelay={closeDelay}
      {...props}
    />
  );
}

/**
 * Wraps a trigger that carries its own click, keeping a tap working.
 *
 * Radix cancels `touchstart` on the trigger so a tap can't open the card — and
 * cancels the emulated click with it, leaving a button trigger dead. It does
 * that unconditionally, so no media query can gate it: a touchscreen laptop
 * reports `hover: hover` and still fires `touchstart`. The guard sits on an
 * inner element, not the trigger: `asChild` merges a handler onto the trigger
 * itself, where Radix composes it with its own and gates only on
 * `defaultPrevented` — which `stopPropagation` never sets. One level down, the
 * event stops before the trigger sees it. Hover is unaffected: React dispatches
 * enter/leave to every element newly entered, the wrapper included.
 *
 * Needs a box of its own, so no `display: contents`: the wrapper is what the
 * card measures itself against.
 */
export function HoverCardTappableTrigger({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <HoverCardTrigger asChild>
      <span className="inline-flex">
        <span
          className="inline-flex"
          onTouchStart={(event) => event.stopPropagation()}
        >
          {children}
        </span>
      </span>
    </HoverCardTrigger>
  );
}

/** Detail that opens on hover or focus and takes no click of its own, so the
 *  trigger keeps its own action. Radix holds the card open across the gap
 *  between trigger and panel, so content here can be reached with the pointer —
 *  but only with the pointer: it stamps `tabindex="-1"` on everything tabbable
 *  inside, on every render. Anything essential needs a second home. */
function HoverCardContent({
  className,
  sideOffset = 8,
  children,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(FLOATING_PANEL, className)}
        {...props}
      >
        {children}
        <HoverCardPrimitive.Arrow asChild>
          <FloatingPanelTail />
        </HoverCardPrimitive.Arrow>
      </HoverCardPrimitive.Content>
    </HoverCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
