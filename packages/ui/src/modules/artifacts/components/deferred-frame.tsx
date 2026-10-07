import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { useArtifactPrompt } from "../hooks/use-artifact-prompt.js";
import { useArtifactRequest } from "../hooks/use-artifact-request.js";

const MODAL_ANIMATION_MS = 220;

export function DeferredFrame({
  html,
  title,
  className,
  deferMs = MODAL_ANIMATION_MS,
  onSendPrompt,
  agentApiArtifactId,
}: {
  html: string;
  title: string;
  className: string;
  deferMs?: number;
  onSendPrompt?: (prompt: string) => Promise<void>;
  agentApiArtifactId?: string;
}) {
  const [mounted, setMounted] = useState(deferMs === 0);
  const [loaded, setLoaded] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  useArtifactPrompt(frameRef, onSendPrompt);
  useArtifactRequest(frameRef, agentApiArtifactId);
  useEffect(() => {
    if (deferMs === 0) return;
    const timer = setTimeout(() => setMounted(true), deferMs);
    return () => clearTimeout(timer);
  }, [deferMs]);

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
