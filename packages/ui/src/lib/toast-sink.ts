export type ToastKind = "error" | "warning" | "success" | "info";

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  action?: { label: string; onClick: () => void };
  /** ms until auto-dismiss. Omit/0 → sticky. */
  ttl?: number;
}

type Sink = (input: Omit<Toast, "id">) => void;

let sink: Sink | null = null;

export const setToastSink = (fn: Sink) => {
  sink = fn;
};

// Module-level indirection so modules that emit toasts (query-helpers) don't
// need to import useStore and create a cycle back into the store root.
export const emitToast: Sink = (input) => sink?.(input);
