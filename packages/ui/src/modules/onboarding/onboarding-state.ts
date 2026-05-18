/**
 * Reactive flag for the "guided empty states" first-run flow.
 *
 * Set to true when the user clicks "Get started" on the welcome modal,
 * cleared when they finish all three setup steps or click "Skip" on a
 * coaching banner. Persisted to localStorage so the flow survives reloads
 * mid-onboarding. The store is a plain module-level subscription set so
 * any component can read/react to it without going through zustand.
 */
import { useSyncExternalStore } from "react";

const KEY = "platform-onboarding-active";
// Mock mode: designer iterating → reset on reload.
const PERSIST = import.meta.env.VITE_USE_MOCKS !== "true";

let _active = PERSIST && typeof localStorage !== "undefined"
  ? localStorage.getItem(KEY) === "true"
  : false;

const subs = new Set<() => void>();

export function isOnboardingActive(): boolean {
  return _active;
}

export function setOnboardingActive(active: boolean): void {
  if (_active === active) return;
  _active = active;
  if (PERSIST) {
    if (active) localStorage.setItem(KEY, "true");
    else localStorage.removeItem(KEY);
  }
  subs.forEach((fn) => fn());
}

export function useOnboardingActive(): boolean {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => _active,
    () => false,
  );
}
