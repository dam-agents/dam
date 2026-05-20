type ApiStatus = "connected" | "reconnecting";

let status: ApiStatus = "connected";
let failureCount = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function setStatus(next: ApiStatus) {
  if (status === next) return;
  status = next;
  notify();
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (!navigator.onLine) return;
    try {
      const res = await fetch("/api/health");
      if (res.ok) {
        failureCount = 0;
        stopPolling();
        setStatus("connected");
      }
    } catch {
      // still down
    }
  }, 3_000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
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
