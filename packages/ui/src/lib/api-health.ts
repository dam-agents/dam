import { onlineManager } from "@tanstack/react-query";

type ApiStatus = "connected" | "reconnecting";

let status: ApiStatus = "connected";
let failureCount = 0;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function setStatus(next: ApiStatus) {
  if (status === next) return;
  status = next;
  for (const l of listeners) l();
}

function startPolling() {
  if (pollTimer) return;
  async function poll() {
    if (status !== "reconnecting") return;
    if (!navigator.onLine) {
      pollTimer = setTimeout(poll, 3_000);
      return;
    }
    try {
      const res = await fetch("/api/health");
      if (res.ok) {
        failureCount = 0;
        pollTimer = null;
        setStatus("connected");
        return;
      }
    } catch {
      // still down
    }
    if (status === "reconnecting") pollTimer = setTimeout(poll, 3_000);
  }
  pollTimer = setTimeout(poll, 3_000);
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

export function onFetchError() {
  if (!navigator.onLine) return;
  failureCount++;
  if (failureCount >= 2 && status === "connected") {
    setStatus("reconnecting");
    startPolling();
  }
}

export function onFetchSuccess() {
  failureCount = 0;
  if (status === "reconnecting") {
    stopPolling();
    setStatus("connected");
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

export function getApiHealthSnapshot(): ApiStatus {
  return status;
}

// Compose browser connectivity + API health into TanStack Query's online
// signal. When either is down, queries pause instead of erroring out.
onlineManager.setEventListener((setOnline) => {
  const update = () => setOnline(navigator.onLine && status !== "reconnecting");

  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  listeners.add(update);

  return () => {
    window.removeEventListener("online", update);
    window.removeEventListener("offline", update);
    listeners.delete(update);
  };
});
