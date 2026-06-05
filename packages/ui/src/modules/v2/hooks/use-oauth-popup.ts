import { useCallback, useEffect, useRef } from "react";

export interface OAuthPopupResult {
  ok: boolean;
  /** Provider/flow message, or a cancellation note. Undefined on success. */
  message?: string;
}

const POPUP_FEATURES = "popup,width=640,height=760";

/**
 * Drives a popup-based OAuth flow. `open()` synchronously opens a blank popup
 * (so the browser doesn't block it), and the caller navigates it to the auth
 * URL once available. The result arrives via a postMessage from the
 * same-origin callback page; a dismissed popup is detected by polling `closed`.
 * `open()` returns null when the popup is blocked, so the caller can fall back.
 */
export function useOAuthPopup(onResult: (result: OAuthPopupResult) => void) {
  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<number | null>(null);
  const onResultRef = useRef(onResult);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const teardown = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    popupRef.current = null;
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as
        | { source?: string; oauth?: string; message?: string }
        | null
        | undefined;
      if (!data || data.source !== "platform-oauth") return;
      popupRef.current?.close();
      teardown();
      onResultRef.current({
        ok: data.oauth === "success",
        message: typeof data.message === "string" ? data.message : undefined,
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [teardown]);

  const open = useCallback((): Window | null => {
    const popup = window.open("about:blank", "platform-oauth", POPUP_FEATURES);
    if (!popup) return null;
    popupRef.current = popup;
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(() => {
      if (popupRef.current?.closed) {
        teardown();
        onResultRef.current({
          ok: false,
          message: "Authorization was cancelled.",
        });
      }
    }, 600);
    return popup;
  }, [teardown]);

  const close = useCallback(() => {
    popupRef.current?.close();
    teardown();
  }, [teardown]);

  return { open, close };
}
