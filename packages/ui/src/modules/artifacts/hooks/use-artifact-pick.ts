import {
  ARTIFACT_PICK_CANCEL_TYPE,
  ARTIFACT_PICK_START_TYPE,
  ARTIFACT_PICK_STOP_TYPE,
  ARTIFACT_PICK_TYPE,
  type ArtifactPickedElement,
} from "api-server-api";
import { type RefObject, useEffect } from "react";
import { match } from "ts-pattern";

import { readArtifactPick } from "../lib/artifact-pick.js";

export interface ArtifactPickHandlers {
  active: boolean;
  onPick: (elements: ArtifactPickedElement[]) => void;
  onCancel: () => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Runs pick mode in the preview frame. The frame
 * has an opaque origin, so the app cannot read its DOM: it asks the picker the
 * renderer put in the frame to start, and takes back what the user picked. A
 * reload of the frame loses pick mode, so the start is sent again on load. The
 * frame is untrusted, so a pick counts only while pick mode is on and only from
 * this frame's window.
 */
export function useArtifactPick(
  frame: RefObject<HTMLIFrameElement | null>,
  pick: ArtifactPickHandlers | undefined,
): void {
  const active = pick?.active ?? false;
  const onPick = pick?.onPick;
  const onCancel = pick?.onCancel;
  useEffect(() => {
    const frameEl = frame.current;
    if (!active || !frameEl || !onPick || !onCancel) return;
    const start = () => {
      frameEl.contentWindow?.postMessage(
        { type: ARTIFACT_PICK_START_TYPE },
        "*",
      );
      frameEl.focus();
    };
    const receive = (event: MessageEvent) => {
      const message = readArtifactPick(event, frameEl.contentWindow);
      if (!message) return;
      match(message)
        .with({ type: ARTIFACT_PICK_TYPE }, ({ elements }) => onPick(elements))
        .with({ type: ARTIFACT_PICK_CANCEL_TYPE }, () => onCancel())
        .exhaustive();
    };
    start();
    frameEl.addEventListener("load", start);
    window.addEventListener("message", receive);
    return () => {
      frameEl.removeEventListener("load", start);
      window.removeEventListener("message", receive);
      frameEl.contentWindow?.postMessage(
        { type: ARTIFACT_PICK_STOP_TYPE },
        "*",
      );
    };
  }, [frame, active, onPick, onCancel]);
}
