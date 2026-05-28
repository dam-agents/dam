import {
  Warning as AlertTriangle,
} from "@carbon/icons-react";

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

import { useStore } from "../store.js";
import { useBodyScrollLock, useFocusTrap } from "./modal.js";

export function DialogOverlay() {
  const dialog = useStore((s) => s.dialog);
  const closeDialog = useStore((s) => s.closeDialog);

  return (
    <AlertDialog open={!!dialog} onOpenChange={(open) => !open && closeDialog(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <AlertDialogTitle>{dialog?.title}</AlertDialogTitle>
              <AlertDialogDescription className="pt-1">{dialog?.message}</AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {dialog?.type === "confirm" && (
            <AlertDialogCancel onClick={() => closeDialog(false)}>Cancel</AlertDialogCancel>
          )}
          <AlertDialogAction onClick={() => closeDialog(true)} autoFocus>
            {dialog?.type === "confirm" ? "Confirm" : "OK"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
