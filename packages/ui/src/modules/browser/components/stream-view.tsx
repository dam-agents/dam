import { type Ref, useCallback, useEffect, useRef, useState } from "react";

import { Spinner } from "@/components/ui/spinner";

import { getAccessToken } from "../../../auth.js";
import { streamPageReload } from "../lib/browser-link.js";

interface Props {
  agentId: string;
  agentName: string;
  reconnects: number;
  ref?: Ref<HTMLIFrameElement>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the agent's screen, as Selkies' stream client
 * draws it, served by the api-server from the released Selkies wheel; its
 * socket reaches the display's stream server through the agent's runtime.
 * The client authenticates with the token in its page's address and
 * reconnects by reloading that page, so each reload of its own, and each
 * reconnect of the panel's control socket, checks the token: once it has been
 * renewed, the page is loaded again with the new one, or every reconnect after
 * the old one expires would be refused.
 */
export function StreamView({ agentId, agentName, reconnects, ref }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const token = useRef<string | null>(null);
  const ownLoad = useRef(false);

  const refresh = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      const current = await getAccessToken();
      if (isCancelled()) return;
      const next = streamPageReload(agentId, token.current, current);
      if (!next) return;
      token.current = current;
      ownLoad.current = true;
      setSrc(next);
    },
    [agentId],
  );

  useEffect(() => {
    let cancelled = false;
    token.current = null;
    void refresh(() => cancelled).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (reconnects > 0) void refresh().catch(() => {});
  }, [reconnects, refresh]);

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
      onLoad={() => {
        if (ownLoad.current) {
          ownLoad.current = false;
          return;
        }
        void refresh().catch(() => {});
      }}
    />
  );
}
