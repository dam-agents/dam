import type {
  CarbonIconType,
} from "@carbon/icons-react";
import {
  CheckmarkOutline as CheckCircle2,
  Close as X,
  Information as Info,
  Warning as AlertTriangle,
  WarningAlt as AlertCircle,
} from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { Toast, ToastKind } from "../modules/platform/store/toast.js";
import { useStore } from "../store.js";

const ICON: Record<ToastKind, CarbonIconType> = {
  error: AlertCircle,
  warning: AlertTriangle,
  success: CheckCircle2,
  info: Info,
};

const TONE: Record<ToastKind, string> = {
  error: "border-destructive text-destructive",
  warning: "border-warning text-warning",
  success: "border-success text-success",
  info: "border-info text-info",
};

export function ToastOverlay() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[90] flex flex-col gap-2 max-w-[calc(100vw-2rem)] w-[360px] pointer-events-none">
      {toasts.map((t) => <ToastRow key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />)}
    </div>
  );
}

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon = ICON[toast.kind];
  const isError = toast.kind === "error";
  return (
    <div
      className={cn(
        "pointer-events-auto rounded-md border bg-popover text-popover-foreground p-3 flex items-start gap-2.5 shadow-md",
        TONE[toast.kind],
      )}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
    >
      <Icon className="h-4 w-4 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 text-sm text-foreground leading-snug break-words">{toast.message}</div>
      {toast.action && (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 shrink-0 font-semibold"
          onClick={() => { toast.action!.onClick(); onDismiss(); }}
        >
          {toast.action.label}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 shrink-0"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}
