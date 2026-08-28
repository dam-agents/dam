import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type SelfRefreshHold, selfRefreshHold } from "../lib/self-refresh.js";

const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
  "focusin",
] as const;

export interface SelfRefreshGate {
  admitAuto: (inFlight: boolean) => SelfRefreshHold | null;
  noteGesture: () => void;
  pause: () => void;
  resume: () => void;
}

export interface SelfRefresh {
  selfRefreshing: boolean;
  hold: SelfRefreshHold | null;
  gate: SelfRefreshGate;
}

export function useSelfRefresh(
  artifactId: string | null,
  bound: boolean,
): SelfRefresh {
  const [selfRefreshing, setSelfRefreshing] = useState(false);
  const [hold, setHold] = useState<SelfRefreshHold | null>(null);

  const lastAutoAt = useRef<number | null>(null);
  const lastActivityAt = useRef(Date.now());
  const hidden = useRef(false);
  const paused = useRef(false);

  useEffect(() => {
    lastAutoAt.current = null;
    lastActivityAt.current = Date.now();
    paused.current = false;
    setSelfRefreshing(false);
    setHold(null);
  }, [artifactId]);

  useEffect(() => {
    if (artifactId === null) return;
    const noteActivity = () => {
      lastActivityAt.current = Date.now();
    };
    const readVisibility = () => {
      hidden.current = document.visibilityState === "hidden";
      if (!hidden.current) noteActivity();
    };
    readVisibility();
    document.addEventListener("visibilitychange", readVisibility);
    for (const kind of ACTIVITY_EVENTS)
      document.addEventListener(kind, noteActivity, {
        capture: true,
        passive: true,
      });
    return () => {
      document.removeEventListener("visibilitychange", readVisibility);
      for (const kind of ACTIVITY_EVENTS)
        document.removeEventListener(kind, noteActivity, { capture: true });
    };
  }, [artifactId]);

  const admitAuto = useCallback(
    (inFlight: boolean) => {
      const now = Date.now();
      const next = selfRefreshHold({
        now,
        bound,
        lastAutoAt: lastAutoAt.current,
        lastActivityAt: lastActivityAt.current,
        hidden: hidden.current,
        paused: paused.current,
        inFlight,
      });
      if (next === null) lastAutoAt.current = now;
      setSelfRefreshing(true);
      setHold(next);
      return next;
    },
    [bound],
  );

  const noteGesture = useCallback(() => {
    lastActivityAt.current = Date.now();
    setHold((current) => (current === "idle" ? null : current));
  }, []);

  const pause = useCallback(() => {
    paused.current = true;
    setHold("paused");
  }, []);

  const resume = useCallback(() => {
    paused.current = false;
    lastActivityAt.current = Date.now();
    setHold(null);
  }, []);

  const gate = useMemo(
    () => ({ admitAuto, noteGesture, pause, resume }),
    [admitAuto, noteGesture, pause, resume],
  );

  return { selfRefreshing, hold, gate };
}
