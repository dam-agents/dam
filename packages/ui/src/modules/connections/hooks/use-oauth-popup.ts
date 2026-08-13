import { useCallback, useEffect, useRef } from "react";

export interface OAuthPopupResult {
  ok: boolean;
  message?: string;
}

const POPUP_FEATURES = "popup,width=640,height=760";
const CLOSE_GRACE_MS = 400;

export function useOAuthPopup(onResult: (result: OAuthPopupResult) => void) {
  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<number | null>(null);
  const settledRef = useRef(false);
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

  const settle = useCallback(
    (result: OAuthPopupResult) => {
      if (settledRef.current) return;
      settledRef.current = true;
      teardown();
      onResultRef.current(result);
    },
    [teardown],
  );

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as
        | { source?: string; oauth?: string; message?: string }
        | null
        | undefined;
      if (!data || data.source !== "platform-oauth") return;
      popupRef.current?.close();
      settle({
        ok: data.oauth === "success",
        message: typeof data.message === "string" ? data.message : undefined,
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [settle]);

  const open = useCallback((): Window | null => {
    const popup = window.open("about:blank", "platform-oauth", POPUP_FEATURES);
    if (!popup) return null;
    popupRef.current = popup;
    settledRef.current = false;
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(() => {
      if (!popupRef.current?.closed) return;
      window.clearInterval(pollRef.current!);
      pollRef.current = null;
      window.setTimeout(
        () => settle({ ok: false, message: "Authorization was cancelled." }),
        CLOSE_GRACE_MS,
      );
    }, 600);
    return popup;
  }, [settle]);

  const close = useCallback(() => {
    settledRef.current = true;
    popupRef.current?.close();
    teardown();
  }, [teardown]);

  const focus = useCallback(() => {
    if (popupRef.current && !popupRef.current.closed) popupRef.current.focus();
  }, []);

  return { open, close, focus };
}
