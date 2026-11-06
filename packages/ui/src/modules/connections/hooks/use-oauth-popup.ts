import { useCallback, useEffect, useRef } from "react";

export interface OAuthPopupResult {
  ok: boolean;
  message?: string;
}

interface PopupMessage {
  source?: string;
  oauth?: string;
  connection?: string;
  message?: string;
}

const POPUP_NAME = "platform-oauth";
const POPUP_FEATURES = "popup,width=640,height=760";
const OAUTH_FLOW_TIMEOUT_MS = 10 * 60 * 1000;

export function useOAuthPopup(onResult: (result: OAuthPopupResult) => void) {
  const popupRef = useRef<Window | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const expectedRef = useRef<string | null>(null);
  const settledRef = useRef(true);
  const onResultRef = useRef(onResult);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const teardown = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    popupRef.current = null;
    expectedRef.current = null;
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
    const resultOf = (data: PopupMessage): OAuthPopupResult => ({
      ok: data.oauth === "success",
      message: typeof data.message === "string" ? data.message : undefined,
    });
    const isResult = (data: unknown): data is PopupMessage =>
      !!data && (data as PopupMessage).source === "platform-oauth";

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (!isResult(e.data)) return;
      popupRef.current?.close();
      settle(resultOf(e.data));
    };
    window.addEventListener("message", onMessage);

    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(POPUP_NAME);
    if (channel)
      channel.onmessage = (e: MessageEvent) => {
        if (!isResult(e.data)) return;
        if (!expectedRef.current || e.data.connection !== expectedRef.current)
          return;
        popupRef.current?.close();
        settle(resultOf(e.data));
      };

    return () => {
      window.removeEventListener("message", onMessage);
      channel?.close();
      teardown();
    };
  }, [settle, teardown]);

  const open = useCallback((): Window | null => {
    const popup = window.open("about:blank", POPUP_NAME, POPUP_FEATURES);
    if (!popup) return null;
    teardown();
    popupRef.current = popup;
    settledRef.current = false;
    timeoutRef.current = window.setTimeout(
      () => settle({ ok: false, message: "Authorization timed out." }),
      OAUTH_FLOW_TIMEOUT_MS,
    );
    return popup;
  }, [settle, teardown]);

  const expect = useCallback((connectionId: string) => {
    expectedRef.current = connectionId;
  }, []);

  const close = useCallback(() => {
    settledRef.current = true;
    popupRef.current?.close();
    teardown();
  }, [teardown]);

  const focus = useCallback((): boolean => {
    if (!popupRef.current || popupRef.current.closed) return false;
    popupRef.current.focus();
    return true;
  }, []);

  return { open, expect, close, focus };
}
