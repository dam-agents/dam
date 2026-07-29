import { WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Spinner } from "@/components/ui/spinner";

import { getApiHealthSnapshot, subscribeApiHealth } from "../lib/api-health.js";

export function ConnectionBanner() {
  const status = useSyncExternalStore(subscribeApiHealth, getApiHealthSnapshot);

  if (status === "connected") return null;

  const offline = status === "offline";
  return (
    <div className="fixed bottom-14 left-0 right-0 z-banner flex h-11 items-center justify-center gap-2 border-t border-warning bg-warning-light px-5 text-[13px] font-semibold text-warning md:bottom-0">
      {offline ? <WifiOff size={14} /> : <Spinner />}
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
