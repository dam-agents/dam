import { Close } from "@carbon/icons-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import { useBodyScrollLock, useFocusTrap } from "../modal.js";
import { Button } from "./button";

const TRANSITION_MS = 150;

interface Props {
  side: "left" | "right";
  label: string;
  closing: boolean;
  onClose: () => void;
  onClosed: () => void;
  className?: string;
  containerClassName?: string;
  children: ReactNode;
}

export function SideDrawer({
  side,
  label,
  closing,
  onClose,
  onClosed,
  className,
  containerClassName,
  children,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  useBodyScrollLock();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => onClosedRef.current(), TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [closing]);
  const open = shown && !closing;
  const hidden = side === "left" ? "-translate-x-full" : "translate-x-full";

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-overlay flex",
        side === "left" ? "justify-start" : "justify-end",
        containerClassName,
      )}
    >
      <button
        type="button"
        aria-label={`Close ${label.toLowerCase()}`}
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-black/50 backdrop-blur-[4px] transition-opacity duration-150",
          open ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={label}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented) onClose();
        }}
        className={cn(
          "relative flex h-full w-full flex-col bg-background shadow-xl transition-transform duration-150 motion-reduce:transition-none",
          side === "left" ? "border-r" : "border-l",
          "border-border",
          open ? "translate-x-0" : hidden,
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The bar at the top of a drawer: the drawer's name
 * and the X that closes it, with the drawer's own actions between them. It is
 * the height of a side panel's header, so the two overlays read alike.
 */
export function SideDrawerHeader({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-[52px] shrink-0 items-center justify-between gap-2 border-b border-border pl-4 pr-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <div className="flex items-center gap-2">
        {children}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Close ${title.toLowerCase()}`}
          tooltip={`Close ${title.toLowerCase()}`}
          onClick={onClose}
        >
          <Close size={16} />
        </Button>
      </div>
    </div>
  );
}
