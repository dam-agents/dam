import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/** Matches the modal's anim-scale-in duration — the srcdoc parse and CDN
 *  script work start only after the animation has finished its frames. */
const MODAL_ANIMATION_MS = 220;

/** Sandboxed iframe (no allow-same-origin: the document runs on a unique
 *  opaque origin — scripts work, the app origin's cookies/DOM/storage stay
 *  unreachable), optionally mounted after a host animation and faded in on
 *  load so heavy documents never make the surrounding UI stutter. */
export function DeferredFrame({
  html,
  title,
  className,
  deferMs = MODAL_ANIMATION_MS,
}: {
  html: string;
  title: string;
  className: string;
  deferMs?: number;
}) {
  const [mounted, setMounted] = useState(deferMs === 0);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (deferMs === 0) return;
    const timer = setTimeout(() => setMounted(true), deferMs);
    return () => clearTimeout(timer);
  }, [deferMs]);

  return (
    <div className={cn("relative", className)}>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-[13px] text-muted-foreground">Loading preview…</p>
        </div>
      )}
      {mounted && (
        <iframe
          sandbox="allow-scripts allow-popups"
          srcDoc={html}
          title={title}
          onLoad={() => setLoaded(true)}
          className={cn(
            "absolute inset-0 h-full w-full transition-opacity duration-200",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </div>
  );
}
