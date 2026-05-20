export type ConnectionStatus = "connected" | "reconnecting" | "offline";

let failureCount = 0;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let status: ConnectionStatus = navigator.onLine ? "connected" : "offline";
const listeners = new Set<() => void>();

function sync() {
  const next: ConnectionStatus = !navigator.onLine
    ? "offline"
    : failureCount >= 2
      ? "reconnecting"
      : "connected";
  if (status === next) return;
  status = next;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (next === "reconnecting") pollTimer = setTimeout(poll, 3_000);
  for (const l of listeners) l();
}

async function poll() {
  pollTimer = null;
  if (failureCount < 2 || !navigator.onLine) return;
  try {
    if ((await fetch("/api/health")).ok) {
      onFetchSuccess();
      return;
    }
  } catch {
    // noop
  }
  if (failureCount >= 2) pollTimer = setTimeout(poll, 3_000);
}

export function onFetchError() {
  if (!navigator.onLine) return;
  failureCount++;
  sync();
}

export function onFetchSuccess() {
  if (failureCount === 0) return;
  failureCount = 0;
  sync();
}

export function subscribeApiHealth(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getApiHealthSnapshot(): ConnectionStatus {
  return status;
}

window.addEventListener("online", sync);
window.addEventListener("offline", sync);
