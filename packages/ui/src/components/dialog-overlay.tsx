import { AlertTriangle } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

import { useStore } from "../store.js";
import { useBodyScrollLock, useFocusTrap } from "./modal.js";

export function DialogOverlay() {
  const dialog = useStore((s) => s.dialog);
  if (!dialog) return null;
  return <DialogOverlayContent />;
}

/** Split so the portal, hooks, and refs only run while a dialog is
 *  actually open. Portaled into `document.body` like `Modal` — see the
 *  comment there for the `z-10` / `z-40` stacking-context rationale. */
function DialogOverlayContent() {
  const dialog = useStore((s) => s.dialog)!;
  const closeDialog = useStore((s) => s.closeDialog);
  const panelRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  useFocusTrap(panelRef);
  useBodyScrollLock();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") closeDialog(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeDialog]);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 md:px-0 bg-black/50 backdrop-blur-[4px] anim-in">
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={labelId}
        className="w-[400px] max-w-[calc(100vw-2rem)] rounded-xl border-2 border-border bg-surface p-5 md:p-6 flex flex-col gap-4 anim-scale-in"
        style={{ boxShadow: "var(--shadow-brutal)" }}
      >
        <div className="flex items-start gap-3">
          <div className="h-8 w-8 rounded-lg bg-accent-light flex items-center justify-center shrink-0 mt-0.5">
            <AlertTriangle size={16} className="text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 id={labelId} className="text-[15px] font-bold text-text mb-1">
              {dialog.title}
            </h3>
            <div className="text-[13px] text-text-secondary leading-relaxed">
              {dialog.message}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          {dialog.type === "confirm" && (
            <button
              className="btn-brutal h-8 rounded-lg border-2 border-border px-4 text-[13px] font-semibold text-text-secondary hover:text-text"
              style={{ boxShadow: "var(--shadow-brutal-sm)" }}
              onClick={() => closeDialog(false)}
            >
              Cancel
            </button>
          )}
          <button
            autoFocus
            className="btn-brutal h-8 rounded-lg border-2 border-accent-hover bg-accent px-4 text-[13px] font-bold text-white"
            style={{ boxShadow: "var(--shadow-brutal-accent)" }}
            onClick={() => closeDialog(true)}
          >
            {dialog.type === "confirm" ? "Confirm" : "OK"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
