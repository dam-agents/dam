import { type RefObject, useCallback, useLayoutEffect, useRef } from "react";

const NEAR_BOTTOM_PX = 30;

export function useStickToBottom(
  ref: RefObject<HTMLElement | null>,
  content: unknown,
) {
  const stuck = useRef(true);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    stuck.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }, [ref]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [ref, content]);

  return onScroll;
}
