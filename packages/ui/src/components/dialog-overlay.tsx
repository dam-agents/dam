import { ConfirmDialog } from "@/components/ui/confirm-dialog";

import { useStore } from "../store.js";

export function DialogOverlay() {
  const dialog = useStore((s) => s.dialog);
  const closeDialog = useStore((s) => s.closeDialog);

  return (
    <ConfirmDialog
      open={!!dialog}
      onOpenChange={(open) => !open && closeDialog(false)}
      kind={dialog?.kind ?? "default"}
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
