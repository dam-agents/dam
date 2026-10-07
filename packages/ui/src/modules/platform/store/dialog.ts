import type { ReactNode } from "react";
import type { StateCreator } from "zustand";

import type { ConfirmDialogProps } from "@/components/ui/confirm-dialog";
import type { ConfirmDialogKind } from "@/components/ui/confirm-dialog";

interface ConfirmOptions {
  kind?: ConfirmDialogKind;
  icon?: ConfirmDialogProps["icon"];
  confirmLabel?: string;
  cancelLabel?: string;
}

type AlertOptions = Omit<ConfirmOptions, "cancelLabel">;

interface DialogState {
  open: boolean;
  type: "alert" | "confirm";
  title: string;
  message: ReactNode;
  kind: ConfirmDialogKind;
  icon?: ConfirmDialogProps["icon"];
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: (ok: boolean) => void;
}

export interface DialogSlice {
  dialog: DialogState | null;
  showAlert: (
    message: ReactNode,
    title?: string,
    options?: AlertOptions,
  ) => Promise<void>;
  showConfirm: (
    message: ReactNode,
    title?: string,
    options?: ConfirmOptions,
  ) => Promise<boolean>;
  closeDialog: (ok: boolean) => void;
  clearClosedDialog: () => void;
}

export const createDialogSlice: StateCreator<DialogSlice> = (set, get) => ({
  dialog: null,
  showAlert: (message, title = "Error", options) =>
    new Promise<void>((resolve) => {
      set({
        dialog: {
          open: true,
          type: "alert",
          title,
          message,
          kind: options?.kind ?? "default",
          confirmLabel: options?.confirmLabel,
          resolve: () => resolve(),
        },
      });
    }),
  showConfirm: (message, title = "Confirm", options) =>
    new Promise<boolean>((resolve) => {
      set({
        dialog: {
          open: true,
          type: "confirm",
          title,
          message,
          kind: options?.kind ?? "default",
          icon: options?.icon,
          confirmLabel: options?.confirmLabel,
          cancelLabel: options?.cancelLabel,
          resolve,
        },
      });
    }),
  closeDialog: (ok) => {
    const dialog = get().dialog;
    if (!dialog?.open) return;
    set({ dialog: { ...dialog, open: false } });
    dialog.resolve(ok);
  },
  clearClosedDialog: () => {
    const dialog = get().dialog;
    if (dialog && !dialog.open) set({ dialog: null });
  },
});
