import { onlineManager } from "@tanstack/react-query";

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
  for (const l of listeners) l();
}

function startPolling() {
  if (pollTimer) return;
  async function poll() {
    if (!apiDown) return;
    if (!navigator.onLine) {
      pollTimer = setTimeout(poll, 3_000);
      return;
    }
    try {
      const res = await fetch("/api/health");
      if (res.ok) {
        failureCount = 0;
        apiDown = false;
        pollTimer = null;
        sync();
        return;
      }
    } catch {
      // still down
    }
    if (apiDown) pollTimer = setTimeout(poll, 3_000);
  }
  pollTimer = setTimeout(poll, 3_000);
}

export function onFetchError() {
  if (!navigator.onLine) return;
  failureCount++;
  if (failureCount >= 2 && !apiDown) {
    apiDown = true;
    sync();
    startPolling();
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

export function isApiReconnecting(): boolean {
  return status === "reconnecting";
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

// Compose browser connectivity + API health into TanStack Query's online
// signal. When either is down, queries pause instead of erroring out.
onlineManager.setEventListener((setOnline) => {
  const onStatusChange = () => setOnline(status === "connected");
  listeners.add(onStatusChange);

  const onConnectivityChange = () => sync();
  window.addEventListener("online", onConnectivityChange);
  window.addEventListener("offline", onConnectivityChange);

  return () => {
    listeners.delete(onStatusChange);
    window.removeEventListener("online", onConnectivityChange);
    window.removeEventListener("offline", onConnectivityChange);
  };
});
