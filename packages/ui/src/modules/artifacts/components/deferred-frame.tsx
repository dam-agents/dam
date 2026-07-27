import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** Matches the modal's anim-scale-in duration — the srcdoc parse and CDN
 *  script work start only after the animation has finished its frames. */
const MODAL_ANIMATION_MS = 220;

/** Sandboxed iframe (no allow-same-origin: the document runs on a unique
 *  opaque origin — scripts work, the app origin's cookies/DOM/storage stay
 *  unreachable), optionally mounted after a host animation and faded in on
 *  load so heavy documents never make the surrounding UI stutter.
 *
 *  `postData` is the one inbound channel a sealed document gets: the host
 *  pushes it via postMessage on load and on every change (the experiments
 *  live view feeds its dashboard this way). Target origin is `"*"` by
 *  necessity — a srcdoc sandbox is an opaque origin — which is safe here
 *  because the payload is the viewer's own data, nothing secret. */
export function DeferredFrame({
  html,
  title,
  className,
  deferMs = MODAL_ANIMATION_MS,
  postData,
}: {
  html: string;
  title: string;
  className: string;
  deferMs?: number;
  postData?: unknown;
}) {
  const [mounted, setMounted] = useState(deferMs === 0);
  const [loaded, setLoaded] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    if (deferMs === 0) return;
    const timer = setTimeout(() => setMounted(true), deferMs);
    return () => clearTimeout(timer);
  }, [deferMs]);

  useEffect(() => {
    if (!loaded || postData === undefined) return;
    frameRef.current?.contentWindow?.postMessage(postData, "*");
  }, [loaded, postData]);

  return (
    <div className={cn("relative", className)}>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-[13px] text-muted-foreground">Loading preview…</p>
        </div>
      )}
      {mounted && (
        <iframe
          ref={frameRef}
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
