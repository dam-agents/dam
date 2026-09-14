import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { ComputeSegment } from "../lib/slots.js";

const SEGMENT_FILL: Record<ComputeSegment["state"], string> = {
  running: "bg-success",
  awake: "bg-accent",
  available: "border border-dashed border-muted-foreground/30",
};

const OPEN_DELAY_MS = 200;
const CLOSE_GRACE_MS = 150;

interface Props {
  segments: readonly ComputeSegment[];
  totalSlots: number;
  label: (segment: ComputeSegment) => string;
  content?: (segment: ComputeSegment) => ReactNode;
  onActivate?: (segment: ComputeSegment) => void;
  ariaLabel: string;
}

function useHoveredSegment() {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const openTimer = useRef<number>(undefined);
  const closeTimer = useRef<number>(undefined);
  const pendingOpenId = useRef<string | null>(null);

  useEffect(
    () => () => {
      window.clearTimeout(openTimer.current);
      window.clearTimeout(closeTimer.current);
    },
    [],
  );

  const cancelOpen = (id: string) => {
    if (pendingOpenId.current !== id) return;
    window.clearTimeout(openTimer.current);
    pendingOpenId.current = null;
  };

  useEffect(() => {
    if (hoveredId === null) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHoveredId(null);
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [hoveredId]);

  return {
    hoveredId,
    show: (id: string, instant = false) => {
      window.clearTimeout(openTimer.current);
      window.clearTimeout(closeTimer.current);
      pendingOpenId.current = null;
      if (instant || hoveredId !== null) {
        setHoveredId(id);
        return;
      }
      pendingOpenId.current = id;
      openTimer.current = window.setTimeout(() => {
        pendingOpenId.current = null;
        setHoveredId(id);
      }, OPEN_DELAY_MS);
    },
    scheduleHide: (id: string) => {
      cancelOpen(id);
      window.clearTimeout(closeTimer.current);
      closeTimer.current = window.setTimeout(() => {
        setHoveredId((current) => (current === id ? null : current));
      }, CLOSE_GRACE_MS);
    },
    hide: (id: string) => {
      cancelOpen(id);
      window.clearTimeout(closeTimer.current);
      setHoveredId((current) => (current === id ? null : current));
    },
  };
}

export function SlotBar({
  segments,
  totalSlots,
  label,
  content,
  onActivate,
  ariaLabel,
}: Props) {
  const hover = useHoveredSegment();

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${totalSlots}, minmax(0, 1fr))` }}
    >
      {segments.map((segment) => {
        const held = segment.state !== "available";
        const id = segment.agentId ?? "available";
        return (
          <TooltipPrimitive.Root
            key={id}
            open={hover.hoveredId === id}
            disableHoverableContent
          >
            <TooltipPrimitive.Trigger asChild>
              <span
                role={held && onActivate ? "button" : "img"}
                aria-label={label(segment)}
                tabIndex={held ? 0 : undefined}
                onClick={() => {
                  if (held) onActivate?.(segment);
                }}
                onKeyDown={(event) => {
                  if (!held || !onActivate) return;
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onActivate(segment);
                }}
                className={cn(
                  "group grid gap-1.5 rounded-sm outline-none",
                  held && onActivate && "cursor-pointer",
                )}
                style={{
                  gridColumn: `span ${segment.slots}`,
                  gridTemplateColumns: `repeat(${segment.slots}, minmax(0, 1fr))`,
                }}
                onPointerEnter={() => hover.show(id)}
                onPointerLeave={() => hover.scheduleHide(id)}
                onFocus={(event) => {
                  if (event.currentTarget.matches(":focus-visible"))
                    hover.show(id, true);
                }}
                onBlur={() => hover.hide(id)}
              >
                {Array.from({ length: segment.slots }, (_, cell) => (
                  <span
                    key={cell}
                    className={cn(
                      "h-2 rounded-sm transition-shadow",
                      SEGMENT_FILL[segment.state],
                      held &&
                        "group-hover:ring-2 group-hover:ring-foreground/40 group-focus-visible:ring-2 group-focus-visible:ring-foreground/40",
                    )}
                  />
                ))}
              </span>
            </TooltipPrimitive.Trigger>
            <TooltipContent
              side="top"
              tail
              aria-label={label(segment)}
              className={cn(
                "text-sm leading-relaxed",
                held && content ? "w-64 p-3" : "max-w-xs px-3 py-2",
              )}
              onPointerEnter={() => hover.show(id, true)}
              onPointerLeave={() => hover.scheduleHide(id)}
            >
              {(held && content?.(segment)) || label(segment)}
            </TooltipContent>
          </TooltipPrimitive.Root>
        );
      })}
    </div>
  );
}
