import { Loader2 } from "lucide-react";

import { useApiHealth } from "../hooks/use-api-health.js";
import { useOnline } from "../hooks/use-online.js";

export function ReconnectingBanner() {
  const status = useApiHealth();
  const online = useOnline();
  if (!online || status === "connected") return null;
  return (
    <div className="fixed bottom-14 left-0 right-0 z-[60] flex h-11 items-center justify-center gap-2 border-t border-warning bg-warning-light px-5 text-[13px] font-semibold text-warning md:bottom-0">
      <Loader2 size={14} className="animate-spin" />
      <span className="sm:hidden">Reconnecting…</span>
      <span className="hidden sm:inline">
        Reconnecting to server — this usually takes a few seconds.
      </span>
    </div>
  );
}
