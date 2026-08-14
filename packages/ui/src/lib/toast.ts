import { toast as sonner } from "sonner";

export type ToastKind = "error" | "warning" | "success" | "info";

export interface Toast {
  kind: ToastKind;
  message: string;
  action?: { label: string; onClick: () => void };
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

let hostReady = false;
const pending: Toast[] = [];

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

export function emitToast(toast: Toast): void {
  if (!hostReady) {
    pending.push(toast);
    return;
  }
  send(toast);
}
