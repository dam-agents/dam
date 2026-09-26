import {
  ARTIFACT_REQUEST_MAX_IN_FLIGHT,
  ARTIFACT_RESPONSE_TYPE,
  type ArtifactCallAgentApiResult,
  type ArtifactResponseMessage,
} from "api-server-api";
import { type RefObject, useEffect } from "react";

import { useCallAgentApi } from "../api/mutations.js";
import { readArtifactRequest } from "../lib/artifact-request.js";

export function useArtifactRequest(
  frame: RefObject<HTMLIFrameElement | null>,
  artifactId: string | undefined,
): void {
  const { mutateAsync: callAgentApi } = useCallAgentApi();
  useEffect(() => {
    if (artifactId === undefined) return;
    let mounted = true;
    let inFlight = 0;
    const receive = (event: MessageEvent) => {
      const pageWindow = frame.current?.contentWindow;
      const read = readArtifactRequest(event, pageWindow);
      if (!read || !pageWindow) return;
      const reply = (result: ArtifactCallAgentApiResult) => {
        if (!mounted || frame.current?.contentWindow !== pageWindow) return;
        const message: ArtifactResponseMessage = {
          type: ARTIFACT_RESPONSE_TYPE,
          id: read.id,
          ...result,
        };
        pageWindow.postMessage(message, "*");
      };
      if (read.request === null) {
        reply({ ok: false, reason: "invalid-request" });
        return;
      }
      if (inFlight >= ARTIFACT_REQUEST_MAX_IN_FLIGHT) {
        reply({ ok: false, reason: "too-many-requests" });
        return;
      }
      inFlight += 1;
      void callAgentApi({ artifactId, ...read.request })
        .catch((): ArtifactCallAgentApiResult => ({
          ok: false,
          reason: "agent-unreachable",
        }))
        .then(reply)
        .finally(() => {
          inFlight -= 1;
        });
    };
    window.addEventListener("message", receive);
    return () => {
      mounted = false;
      window.removeEventListener("message", receive);
    };
  }, [frame, artifactId, callAgentApi]);
}
