import { TrashCan, Warning, WarningAlt } from "@carbon/icons-react";
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
import { buttonVariants } from "@/components/ui/button";
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

// Reusable confirm/alert dialog. The destructive variant uses a muted red
// icon chip and a red action button with a trash glyph (DAM-9). Use this for
// any "are you sure?" flow — the global DialogOverlay drives it from the
// store; ad-hoc destructive prompts can render it directly.
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
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "h-8 w-8 rounded-md flex items-center justify-center shrink-0",
                destructive ? "bg-destructive/10" : "bg-primary/10",
              )}
            >
              {destructive ? (
                <WarningAlt className="h-4 w-4 text-destructive" />
              ) : (
                <Warning className="h-4 w-4 text-primary" />
              )}
            </div>
            <AlertDialogTitle>{title}</AlertDialogTitle>
          </div>
          {description && (
            // asChild renders a div — the message can carry block elements
            // (lists, boxes), which are invalid inside the default <p>.
            <AlertDialogDescription asChild>
              <div className="pt-1 text-[14px] text-muted-foreground">
                {description}
              </div>
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          {showCancel && (
            <AlertDialogCancel onClick={() => onCancel?.()}>
              {cancelLabel}
            </AlertDialogCancel>
          )}
          <AlertDialogAction
            onClick={() => onConfirm()}
            autoFocus
            className={cn(
              destructive && buttonVariants({ variant: "destructive" }),
            )}
          >
            {destructive && <TrashCan size={16} />}
            {resolvedConfirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
