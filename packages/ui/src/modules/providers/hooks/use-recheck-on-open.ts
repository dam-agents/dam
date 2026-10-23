import { useEffect, useRef } from "react";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Settings / Providers checks the keys it can check
 * once each time the page opens, so a key that stopped working reads as
 * refused without the user pressing Recheck. Later renders, refetches and the
 * finished check do not check again; opening the page again does.
 */
export function useRecheckOnOpen(recheck: () => void, ready: boolean): void {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !ready) return;
    done.current = true;
    recheck();
  }, [ready, recheck]);
}
