import { toast as sonner } from "sonner";

export type ToastKind = "error" | "warning" | "success" | "info";

export interface Toast {
  kind: ToastKind;
  message: string;
  /** Primary affirmative action — opens a flow, navigates, etc. Clicking
   *  also dismisses the toast. */
  action?: { label: string; onClick: () => void };
  /** ms until auto-dismiss. Omit → 5s default; 0 → sticky. */
  ttl?: number;
}

const DEFAULT_TTL = 5000;

type EmitOpts = Parameters<typeof sonner.success>[1];

const EMIT: Record<
  ToastKind,
  (message: string, opts?: EmitOpts) => string | number
> = {
  error: sonner.error,
  warning: sonner.warning,
  success: sonner.success,
  info: sonner.info,
};

/** Surface a toast through Sonner. The single emit path for the whole app —
 *  React components and non-React modules (query helpers) both call this. */
export function emitToast({
  kind,
  message,
  action,
  ttl,
}: Toast): string | number {
  return EMIT[kind](message, {
    action,
    duration: ttl === undefined ? DEFAULT_TTL : ttl > 0 ? ttl : Infinity,
  });
}
