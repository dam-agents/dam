import type { ReactNode } from "react";
import type { StateCreator } from "zustand";
import type { PlatformStore } from "../store.js";

export interface DialogState {
  type: "alert" | "confirm";
  title: string;
  message: ReactNode;
  resolve: (ok: boolean) => void;
}

export interface DialogSlice {
  dialog: DialogState | null;
  showAlert: (message: ReactNode, title?: string) => Promise<void>;
  showConfirm: (message: ReactNode, title?: string) => Promise<boolean>;
  closeDialog: (ok: boolean) => void;
}

export const createDialogSlice: StateCreator<PlatformStore, [], [], DialogSlice> = (set, get) => ({
  dialog: null,
  showAlert: (message, title = "Error") =>
    new Promise<void>((resolve) => {
      set({ dialog: { type: "alert", title, message, resolve: () => resolve() } });
    }),
  showConfirm: (message, title = "Confirm") =>
    new Promise<boolean>((resolve) => {
      set({ dialog: { type: "confirm", title, message, resolve } });
    }),
  closeDialog: (ok) => {
    const d = get().dialog;
    if (d) { d.resolve(ok); set({ dialog: null }); }
  },
});
