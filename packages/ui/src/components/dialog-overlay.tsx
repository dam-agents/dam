import { useEffect, useRef } from "react";
import { useStore } from "../store.js";
import { AlertTriangle } from "lucide-react";

export function DialogOverlay() {
  const dialog = useStore(s => s.dialog);
  const closeDialog = useStore(s => s.closeDialog);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (dialog) confirmRef.current?.focus();
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") closeDialog(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, closeDialog]);

  if (!dialog) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-[4px] anim-in">
      <div
        className="w-[400px] max-w-[calc(100vw-2rem)] rounded-xl border-2 border-border bg-surface p-5 md:p-6 flex flex-col gap-4 anim-scale-in"
        style={{ boxShadow: "var(--shadow-brutal)" }}
      >
        <div className="flex items-start gap-3">
          <div className="h-8 w-8 rounded-lg bg-accent-light flex items-center justify-center shrink-0 mt-0.5">
            <AlertTriangle size={16} className="text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[15px] font-bold text-text mb-1">{dialog.title}</h3>
            <div className="text-[13px] text-text-secondary leading-relaxed">{dialog.message}</div>
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
            ref={confirmRef}
            className="btn-brutal h-8 rounded-lg border-2 border-accent-hover bg-accent px-4 text-[13px] font-bold text-white"
            style={{ boxShadow: "var(--shadow-brutal-accent)" }}
            onClick={() => closeDialog(true)}
          >
            {dialog.type === "confirm" ? "Confirm" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
