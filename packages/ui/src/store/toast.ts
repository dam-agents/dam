import type { StateCreator } from "zustand";
import type { PlatformStore } from "../store.js";
import { setToastSink, type Toast, type ToastKind } from "./toast-sink.js";

export type { Toast, ToastKind };

export interface ToastSlice {
  toasts: Toast[];
  showToast: (input: Omit<Toast, "id">) => string;
  dismissToast: (id: string) => void;
}

const DEFAULT_TTL = 5000;

export const createToastSlice: StateCreator<PlatformStore, [], [], ToastSlice> = (set, get) => {
  const showToast = (input: Omit<Toast, "id">) => {
    const id = crypto.randomUUID();
    const ttl = input.ttl ?? DEFAULT_TTL;
    set((s) => ({ toasts: [...s.toasts, { id, ...input, ttl }] }));
    if (ttl > 0) setTimeout(() => get().dismissToast(id), ttl);
    return id;
  };
  setToastSink(showToast);
  return {
    toasts: [],
    showToast,
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  };
};
