import { Loader2, WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";

import { getApiHealthSnapshot, subscribeApiHealth } from "../lib/api-health.js";

export function ConnectionBanner() {
  const status = useSyncExternalStore(subscribeApiHealth, getApiHealthSnapshot);

  if (status === "connected") return null;

  const offline = status === "offline";
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
