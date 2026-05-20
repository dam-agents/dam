import { Loader2, WifiOff } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { getApiHealthSnapshot, subscribeApiHealth } from "../lib/api-health.js";
import { queryClient } from "../query-client.js";

export function ConnectionBanner() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const apiStatus = useSyncExternalStore(
    subscribeApiHealth,
    getApiHealthSnapshot,
  );
  const prevRef = useRef(apiStatus);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    if (prevRef.current === "reconnecting" && apiStatus === "connected") {
      queryClient.invalidateQueries();
    }
    prevRef.current = apiStatus;
  }, [apiStatus]);

  if (online && apiStatus === "connected") return null;

  const offline = !online;
  return (
    <div className="fixed bottom-14 left-0 right-0 z-[60] flex h-11 items-center justify-center gap-2 border-t border-warning bg-warning-light px-5 text-[13px] font-semibold text-warning md:bottom-0">
      {offline ? (
        <WifiOff size={14} />
      ) : (
        <Loader2 size={14} className="animate-spin" />
      )}
      <span className="sm:hidden">
        {offline ? "Offline — retrying when back" : "Reconnecting…"}
      </span>
      <span className="hidden sm:inline">
        {offline
          ? "You're offline — updates will resume when your connection returns."
          : "Reconnecting to server — this usually takes a few seconds."}
      </span>
    </div>
  );
}
