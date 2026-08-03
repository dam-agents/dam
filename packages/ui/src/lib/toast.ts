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

/** Sonner fans a toast out to whoever is subscribed at publish time and keeps
 *  no backlog, so anything emitted before `<Toaster>` mounts is lost for good.
 *  On a cold load that silently swallows mount-time toasts — including the
 *  OAuth result, which only ever arrives on a cold load. */
let hostReady = false;
const pending: Toast[] = [];

/** Called by the Toaster wrapper once Sonner is subscribed. */
export function onToastHostMounted(): () => void {
  hostReady = true;
  for (const toast of pending.splice(0)) send(toast);
  return () => {
    hostReady = false;
  };
}

function send({ kind, message, action, ttl }: Toast): void {
  EMIT[kind](message, {
    action,
    duration: ttl === undefined ? DEFAULT_TTL : ttl > 0 ? ttl : Infinity,
  });
}

/** Surface a toast through Sonner. The single emit path for the whole app —
 *  React components and non-React modules (query helpers) both call this. */
export function emitToast(toast: Toast): void {
  if (!hostReady) {
    pending.push(toast);
    return;
  }
  send(toast);
}
