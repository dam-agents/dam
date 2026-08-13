import {
  Information,
  TrashCan,
  Warning,
  WarningAlt,
} from "@carbon/icons-react";
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

export type ConfirmDialogKind = "default" | "destructive" | "info";

const KIND_ICON = {
  default: Warning,
  destructive: WarningAlt,
  info: Information,
} as const satisfies Record<ConfirmDialogKind, typeof Warning>;

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
  const Icon = KIND_ICON[kind];
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
              <Icon
                className={cn(
                  "h-4 w-4",
                  destructive ? "text-destructive" : "text-primary",
                )}
              />
            </div>
            <AlertDialogTitle>{title}</AlertDialogTitle>
          </div>
          {description && (
            <AlertDialogDescription asChild>
              <div className="pt-1 text-sm text-muted-foreground">
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
