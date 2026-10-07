import { type Ref, useEffect, useState } from "react";

import { Spinner } from "@/components/ui/spinner";

import { getAccessToken } from "../../../auth.js";

interface Props {
  agentId: string;
  agentName: string;
  ref?: Ref<HTMLIFrameElement>;
}

export function StreamView({ agentId, agentName, ref }: Props) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getAccessToken().then((token) => {
      if (cancelled) return;
      setSrc(
        `/api/public/browser-stream/${encodeURIComponent(agentId)}/index.html?token=${encodeURIComponent(token)}`,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  if (!src)
    return (
      <div className="flex h-full items-center justify-center gap-3 text-sm text-muted-foreground">
        <Spinner size={18} />
        Connecting to the agent's screen…
      </div>
    );
  return (
    <iframe
      ref={ref}
      src={src}
      title={`Browser in ${agentName}'s sandbox`}
      className="h-full w-full border-0"
      allow="autoplay; clipboard-read; clipboard-write; fullscreen"
    />
  );
}
