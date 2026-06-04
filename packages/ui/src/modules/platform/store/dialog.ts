import type { ReactNode } from "react";
import type { StateCreator } from "zustand";

import type { ConfirmDialogKind } from "@/components/ui/confirm-dialog";

import type { PlatformStore } from "../../../store.js";

export interface ConfirmOptions {
  kind?: ConfirmDialogKind;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface DialogState {
  type: "alert" | "confirm";
  title: string;
  message: ReactNode;
  kind: ConfirmDialogKind;
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: (ok: boolean) => void;
}

export interface DialogSlice {
  dialog: DialogState | null;
  showAlert: (message: ReactNode, title?: string) => Promise<void>;
  showConfirm: (
    message: ReactNode,
    title?: string,
    options?: ConfirmOptions,
  ) => Promise<boolean>;
  closeDialog: (ok: boolean) => void;
}

export const createDialogSlice: StateCreator<
  PlatformStore,
  [],
  [],
  DialogSlice
> = (set, get) => ({
  dialog: null,
  showAlert: (message, title = "Error") =>
    new Promise<void>((resolve) => {
      set({
        dialog: {
          type: "alert",
          title,
          message,
          kind: "default",
          resolve: () => resolve(),
        },
      });
    }),
  showConfirm: (message, title = "Confirm", options) =>
    new Promise<boolean>((resolve) => {
      set({
        dialog: {
          type: "confirm",
          title,
          message,
          kind: options?.kind ?? "default",
          confirmLabel: options?.confirmLabel,
          cancelLabel: options?.cancelLabel,
          resolve,
        },
      });
    }),
  closeDialog: (ok) => {
    const d = get().dialog;
    if (d) {
      d.resolve(ok);
      set({ dialog: null });
    }
  },
});
