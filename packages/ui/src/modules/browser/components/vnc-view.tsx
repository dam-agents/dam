import RFB from "@novnc/novnc";
import { useEffect, useRef, useState } from "react";

import { Spinner } from "@/components/ui/spinner";

import { getAccessToken } from "../../../auth.js";

const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000];

interface Props {
  agentId: string;
  agentName: string;
}

export function VncView({ agentId, agentName }: Props) {
  const targetRef = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const failuresRef = useRef(0);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    let cancelled = false;
    let rfb: RFB | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    void (async () => {
      const token = await getAccessToken();
      if (cancelled) return;
      const scheme = location.protocol === "https:" ? "wss:" : "ws:";
      rfb = new RFB(
        target,
        `${scheme}//${location.host}/api/agents/${encodeURIComponent(agentId)}/browser?vnc=1&token=${encodeURIComponent(token)}`,
        { shared: true },
      );
      rfb.resizeSession = true;
      rfb.scaleViewport = false;
      rfb.clipViewport = false;
      rfb.focusOnClick = true;
      rfb.qualityLevel = 8;
      rfb.compressionLevel = 2;
      rfb.background = "transparent";
      rfb.addEventListener("connect", () => {
        failuresRef.current = 0;
        if (!cancelled) setConnected(true);
      });
      rfb.addEventListener("disconnect", () => {
        if (cancelled) return;
        setConnected(false);
        const failures = failuresRef.current++;
        retry = setTimeout(
          () => setAttempt((a) => a + 1),
          RECONNECT_DELAYS_MS[
            Math.min(failures, RECONNECT_DELAYS_MS.length - 1)
          ],
        );
      });
    })();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      rfb?.disconnect();
    };
  }, [agentId, attempt]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={targetRef}
        aria-label={`Screen of ${agentName}'s sandbox`}
        className="h-full w-full overflow-hidden"
      />
      {!connected && (
        <div className="absolute inset-0 flex items-center justify-center gap-3 bg-background/80 text-sm text-muted-foreground">
          <Spinner size={18} />
          Connecting to the agent's screen…
        </div>
      )}
    </div>
  );
}
