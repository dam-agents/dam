export type ConnectionStatus = "connected" | "reconnecting" | "offline";

let apiDown = false;
let failureCount = 0;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let status: ConnectionStatus = navigator.onLine ? "connected" : "offline";
const listeners = new Set<() => void>();

function sync() {
  const next: ConnectionStatus = !navigator.onLine
    ? "offline"
    : apiDown
      ? "reconnecting"
      : "connected";
  if (status === next) return;
  status = next;
  if (next === "reconnecting" && !pollTimer)
    pollTimer = setTimeout(poll, 3_000);
  for (const l of listeners) l();
}

async function poll() {
  pollTimer = null;
  if (!apiDown || !navigator.onLine) return;
  try {
    const res = await fetch("/api/health");
    if (res.ok) {
      onFetchSuccess();
      return;
    }
  } catch {
    // still down
  }
  if (apiDown) pollTimer = setTimeout(poll, 3_000);
}

export function onFetchError() {
  if (!navigator.onLine) return;
  failureCount++;
  if (failureCount >= 2 && !apiDown) {
    apiDown = true;
    sync();
  }
}

export function onFetchSuccess() {
  failureCount = 0;
  if (apiDown) {
    apiDown = false;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    sync();
  }
}

export function subscribeApiHealth(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getApiHealthSnapshot(): ConnectionStatus {
  return status;
}

window.addEventListener("online", sync);
window.addEventListener("offline", sync);
