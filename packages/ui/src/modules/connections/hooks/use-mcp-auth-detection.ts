import { useEffect, useRef, useState } from "react";

import { useDiscoverMcp } from "../api/mutations.js";
import { validateMcpUrl } from "../lib/mcp-url.js";

const DETECT_DEBOUNCE_MS = 500;

export function useMcpAuthDetection(url: string): {
  detected: "oauth" | "none" | null;
  detecting: boolean;
} {
  const [detected, setDetected] = useState<"oauth" | "none" | null>(null);
  const [detecting, setDetecting] = useState(false);
  const discover = useDiscoverMcp({ silent: true });
  const latestUrlRef = useRef(url);
  latestUrlRef.current = url;

  useEffect(() => {
    setDetected(null);
    if (validateMcpUrl(url) !== null) {
      setDetecting(false);
      return;
    }
    setDetecting(true);
    const handle = setTimeout(() => {
      discover
        .mutateAsync({ url })
        .then((r) => {
          if (latestUrlRef.current === url) setDetected(r.auth);
        })
        .catch(() => {
          if (latestUrlRef.current === url) setDetected(null);
        })
        .finally(() => {
          if (latestUrlRef.current === url) setDetecting(false);
        });
    }, DETECT_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return { detected, detecting };
}
