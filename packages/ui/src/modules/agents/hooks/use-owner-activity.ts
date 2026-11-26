import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { trpc } from "../../../trpc.js";
import { usePageVisible } from "./use-page-visible.js";

const TOUCH_EVERY_MS = 60_000;
const RECENT_INPUT_MS = 120_000;
const INPUT_EVENTS = [
  "keydown",
  "pointerdown",
  "pointermove",
  "wheel",
  "touchstart",
] as const;

/**
 * UNIT_BOUNDARY_DESCRIPTION: tells the server, every 60 seconds, that the
 * signed-in user uses the web UI, while the tab is visible and the keyboard,
 * the mouse or touch was used in the last two minutes; opening the app counts
 * as a use. A request that waits for the user then reaches them here instead
 * of as a Slack card. It shows nothing, and a failed call stays silent.
 */
export function useOwnerActivity(): void {
  const visible = usePageVisible();
  const lastInput = useRef(Date.now());
  const { mutate } = useMutation({
    ...trpc.ownerActivity.touch.mutationOptions(),
    meta: { suppressErrorToast: true },
  });

  useEffect(() => {
    const mark = () => {
      lastInput.current = Date.now();
    };
    for (const name of INPUT_EVENTS)
      window.addEventListener(name, mark, { passive: true, capture: true });
    return () => {
      for (const name of INPUT_EVENTS)
        window.removeEventListener(name, mark, { capture: true });
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const touch = () => {
      if (Date.now() - lastInput.current < RECENT_INPUT_MS) mutate();
    };
    touch();
    const timer = window.setInterval(touch, TOUCH_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [visible, mutate]);
}
