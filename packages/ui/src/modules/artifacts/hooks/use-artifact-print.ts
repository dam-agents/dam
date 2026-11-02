import { type RefObject, useEffect } from "react";

import {
  readArtifactSize,
  restoreAfterPrint,
  stretchForPrint,
} from "../lib/artifact-print.js";

export function useArtifactPrint(
  frame: RefObject<HTMLIFrameElement | null>,
): void {
  useEffect(() => {
    let height = 0;
    const receive = (event: MessageEvent) => {
      const reported = readArtifactSize(event, frame.current?.contentWindow);
      if (reported !== null) height = reported;
    };
    const beforePrint = () => {
      if (frame.current && height) stretchForPrint(frame.current, height);
    };
    const afterPrint = () => {
      if (frame.current) restoreAfterPrint(frame.current);
    };
    window.addEventListener("message", receive);
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.removeEventListener("message", receive);
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, [frame]);
}
