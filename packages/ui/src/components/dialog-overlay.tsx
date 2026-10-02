import { ConfirmDialog } from "@/components/ui/confirm-dialog";

import { useStore } from "../store.js";

export function DialogOverlay() {
  const dialog = useStore((s) => s.dialog);
  const closeDialog = useStore((s) => s.closeDialog);
  const clearClosedDialog = useStore((s) => s.clearClosedDialog);

  return (
    <ConfirmDialog
      open={dialog?.open ?? false}
      onOpenChange={(open) => !open && closeDialog(false)}
      onCloseAnimationEnd={clearClosedDialog}
      kind={dialog?.kind ?? "default"}
      icon={dialog?.icon}
      title={dialog?.title ?? ""}
      description={dialog?.message}
      confirmLabel={dialog?.confirmLabel}
      cancelLabel={dialog?.cancelLabel}
      showCancel={dialog?.type === "confirm"}
      onConfirm={() => closeDialog(true)}
      onCancel={() => closeDialog(false)}
    />
  );
}
