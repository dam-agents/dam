import { useSyncExternalStore } from "react";

type MessengerKind = "slack" | "telegram";

interface BindModalState {
  channels: MessengerKind[] | null;
}

let state: BindModalState = { channels: null };
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function openBindModal(channels: MessengerKind[]) {
  state = { channels };
  emit();
}

export function closeBindModal() {
  state = { channels: null };
  emit();
}

export function useBindModalState(): BindModalState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}
