import { WifiOff } from "lucide-react";

import { useOnline } from "../hooks/use-online.js";

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="fixed bottom-14 left-0 right-0 z-[60] flex h-11 items-center justify-center gap-2 border-t border-warning bg-warning-light px-5 text-[13px] font-semibold text-warning md:bottom-0">
      <WifiOff size={14} />
      <span className="sm:hidden">Offline — retrying when back</span>
      <span className="hidden sm:inline">
        You're offline — updates will resume when your connection returns.
      </span>
    </div>
  );
}
