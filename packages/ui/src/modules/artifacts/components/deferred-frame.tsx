import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { useArtifactPrompt } from "../hooks/use-artifact-prompt.js";

const MODAL_ANIMATION_MS = 220;

export function DeferredFrame({
  html,
  title,
  className,
  deferMs = MODAL_ANIMATION_MS,
  postData,
  onSendPrompt,
}: {
  html: string;
  title: string;
  className: string;
  deferMs?: number;
  postData?: unknown;
  onSendPrompt?: (prompt: string) => Promise<void>;
}) {
  const [mounted, setMounted] = useState(deferMs === 0);
  const [loaded, setLoaded] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  useArtifactPrompt(frameRef, onSendPrompt);
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
          <p className="text-sm text-muted-foreground">Loading preview…</p>
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
