/**
 * Digest state — tracks when the user last visited the home page.
 * Persists to localStorage so the "Since X" window survives page reloads.
 */

import { useCallback, useSyncExternalStore } from "react";

import {
  DIGEST_MAX_WINDOW_DAYS,
  DIGEST_MIN_WINDOW_MINUTES,
} from "./home-thresholds.js";

const STORAGE_KEY = "home:digestSince";

type DigestRange = "auto" | "1h" | "4h" | "12h" | "24h" | "3d" | "7d";

export const DIGEST_RANGE_OPTIONS: { value: DigestRange; label: string }[] = [
  { value: "auto", label: "Since last visit" },
  { value: "1h", label: "Last hour" },
  { value: "4h", label: "Last 4 hours" },
  { value: "12h", label: "Last 12 hours" },
  { value: "24h", label: "Last 24 hours" },
  { value: "3d", label: "Last 3 days" },
  { value: "7d", label: "Last 7 days" },
];

export type { DigestRange };

const RANGE_MS: Record<Exclude<DigestRange, "auto">, number> = {
  "1h": 1 * 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

let listeners: Array<() => void> = [];
function emit() {
  cachedSnapshot = computeDigestSince();
  for (const l of listeners) l();
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(iso: string) {
  try {
    localStorage.setItem(STORAGE_KEY, iso);
  } catch {
    // ignore quota errors
  }
}

let rangeOverride: DigestRange = "auto";

function computeDigestSince(): string {
  if (rangeOverride !== "auto") {
    const ms = RANGE_MS[rangeOverride];
    return new Date(Date.now() - ms).toISOString();
  }

  const stored = readStored();
  if (stored) {
    const parsed = Date.parse(stored);
    if (!Number.isNaN(parsed)) {
      const maxMs = DIGEST_MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      const minMs = DIGEST_MIN_WINDOW_MINUTES * 60 * 1000;
      const age = Date.now() - parsed;
      if (age <= maxMs && age >= minMs) return stored;
      if (age > maxMs) return new Date(Date.now() - maxMs).toISOString();
    }
  }

  // First visit ever or invalid stored value — default to 4h
  return new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
}

let cachedSnapshot = computeDigestSince();

function getSnapshot() {
  return cachedSnapshot;
}

function subscribe(cb: () => void) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

export function useDigestSince(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useDigestRange(): [DigestRange, (r: DigestRange) => void] {
  const setRange = useCallback((r: DigestRange) => {
    rangeOverride = r;
    emit();
  }, []);

  return [rangeOverride, setRange];
}

export function markVisitNow() {
  writeStored(new Date().toISOString());
  emit();
}
