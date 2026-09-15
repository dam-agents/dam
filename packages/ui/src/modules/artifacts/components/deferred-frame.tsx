import {
  ARTIFACT_BRIDGE_CONNECT_TYPE,
  type ArtifactBridgeReply,
  type PageArtifactRequest,
} from "api-server-api";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { readPageRequest } from "../lib/page-request.js";

const MODAL_ANIMATION_MS = 220;

export type ArtifactReplySender = (reply: ArtifactBridgeReply) => void;

export interface ArtifactFrameBridge {
  onConnect: (send: ArtifactReplySender) => void;
  onDisconnect: (send: ArtifactReplySender) => void;
  onRequest: (request: PageArtifactRequest) => void;
}

export function DeferredFrame({
  html,
  title,
  className,
  deferMs = MODAL_ANIMATION_MS,
  postData,
  bridge,
}: {
  html: string;
  title: string;
  className: string;
  deferMs?: number;
  postData?: unknown;
  bridge?: ArtifactFrameBridge;
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

  useEffect(() => {
    const pageWindow = frameRef.current?.contentWindow;
    if (!loaded || !bridge || !pageWindow) return;

    const channel = new MessageChannel();
    const send: ArtifactReplySender = (reply) =>
      channel.port1.postMessage(reply);
    const readRequest = (event: MessageEvent) => {
      const request = readPageRequest(event, pageWindow);
      if (request) bridge.onRequest(request);
    };
    window.addEventListener("message", readRequest);
    bridge.onConnect(send);
    pageWindow.postMessage({ type: ARTIFACT_BRIDGE_CONNECT_TYPE }, "*", [
      channel.port2,
    ]);

    return () => {
      window.removeEventListener("message", readRequest);
      bridge.onDisconnect(send);
      channel.port1.close();
    };
  }, [loaded, bridge]);

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
          sandbox="allow-scripts allow-popups allow-forms"
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
