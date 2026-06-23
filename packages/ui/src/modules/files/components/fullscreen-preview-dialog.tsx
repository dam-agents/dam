import { Close as X } from "@carbon/icons-react";
import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** Full-viewport modal hosting a file preview at full size. Portaled to <body>
 * so it escapes the file panel's layout; Escape or the close button dismisses
 * it, and body scroll is locked while open. */
export function FullscreenPreviewDialog({ title, onClose, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      <div className="flex items-center gap-2 px-3 h-9 border-b border-border shrink-0">
        <span
          className="text-[12px] font-mono text-foreground/80 truncate flex-1"
          title={title}
        >
          {title}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto px-2 py-0.5 text-[11px] font-semibold text-muted-foreground hover:text-primary"
          onClick={onClose}
          title="Exit fullscreen (Esc)"
        >
          <X size={11} /> Close
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-4">{children}</div>
    </div>,
    document.body,
  );
}
