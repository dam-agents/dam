import { Warning as WarningIcon } from "@carbon/icons-react";
import type { ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export type ConfirmDialogKind = "default" | "destructive";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind?: ConfirmDialogKind;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  showCancel?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}

// Reusable confirm/alert dialog. The destructive variant paints the icon
// chip with the destructive token (white glyph on red) so the consequence
// reads at a glance, but the action button keeps the default token —
// destructive-on-destructive doubled the visual weight without adding any
// information. Use this for any "are you sure?" flow — the global
// DialogOverlay drives it from the store; ad-hoc destructive prompts can
// render it directly.
export function ConfirmDialog({
  open,
  onOpenChange,
  kind = "default",
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  showCancel = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const destructive = kind === "destructive";
  const resolvedConfirmLabel =
    confirmLabel ?? (showCancel ? (destructive ? "Remove" : "Confirm") : "OK");

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel?.();
        onOpenChange(o);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "h-8 w-8 rounded-md flex items-center justify-center shrink-0",
                destructive ? "bg-destructive" : "bg-primary/10",
              )}
            >
              <WarningIcon
                className={cn(
                  "h-4 w-4",
                  destructive ? "text-white" : "text-primary",
                )}
              />
            </div>
            <div className="flex-1 min-w-0">
              <AlertDialogTitle>{title}</AlertDialogTitle>
              {description && (
                <AlertDialogDescription className="pt-1">
                  {description}
                </AlertDialogDescription>
              )}
            </div>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {showCancel && (
            <AlertDialogCancel onClick={() => onCancel?.()}>
              {cancelLabel}
            </AlertDialogCancel>
          )}
          <AlertDialogAction onClick={() => onConfirm()} autoFocus>
            {resolvedConfirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
