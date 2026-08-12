import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import * as React from "react";
import { useSyncExternalStore } from "react";

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

const HOVER_QUERY = "(hover: hover) and (pointer: fine)";

function subscribeHover(onChange: () => void) {
  const mq = window.matchMedia(HOVER_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * Whether this input can hover at all — the precondition for wrapping anything
 * in a `HoverCard`.
 *
 * A trigger that is also a button must render bare on touch: Radix cancels
 * `touchstart` on the trigger to keep the card from opening on a tap, and that
 * cancels the emulated click with it, leaving the button dead. Nothing is lost,
 * since a card that only opens on hover was already unreachable there.
 */
export function useCanHover(): boolean {
  return useSyncExternalStore(
    subscribeHover,
    () => window.matchMedia(HOVER_QUERY).matches,
    () => false,
  );
}

/** Detail that opens on hover or focus and takes no click of its own, so the
 *  trigger keeps its own action. Radix holds the card open across the gap
 *  between trigger and panel, so content here can be reached with the pointer.
 *  Nothing essential belongs in it: a touch device gets no hover at all. */
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
