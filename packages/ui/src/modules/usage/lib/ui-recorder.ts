import type { UiEvent, UiFlow, UiFlowStep, UiSignal } from "api-server-api";

export const RAGE_CLICKS = 3;
export const RAGE_WINDOW_MS = 1_000;
export const BOUNCE_WINDOW_MS = 5_000;
export const ERROR_ATTRIBUTION_MS = 5_000;
export const MAX_PENDING = 500;

const MAX_MS = 86_400_000;

type WithoutPlacement<E> = E extends UiEvent
  ? Omit<E, "seq" | "ageMs" | "route">
  : never;
type Draft = WithoutPlacement<UiEvent>;

const ms = (value: number) => Math.min(MAX_MS, Math.max(0, Math.round(value)));

interface Pending {
  at: number;
  event: Omit<UiEvent, "ageMs">;
}

export interface UiRecorder {
  routeChanged(route: string): void;
  hidden(): void;
  click(element: string): void;
  signal(signal: UiSignal, element: string | null, durationMs?: number): void;
  errorShown(element: string | null): void;
  flowStep(flow: UiFlow, step: UiFlowStep): void;
  drain(max: number): UiEvent[];
  size(): number;
}

export function createUiRecorder(now: () => number): UiRecorder {
  let seq = 0;
  let pending: Pending[] = [];
  let route: string | null = null;
  let openView: { seq: number; at: number } | null = null;
  let left: { route: string; at: number } | null = null;
  let recentClicks: Array<{ element: string; at: number }> = [];
  let lastClick: { element: string; at: number } | null = null;

  function push(draft: Draft, at = now(), place = seq++): void {
    if (route === null) return;
    pending.push({
      at,
      event: { ...draft, route, seq: place } as Pending["event"],
    });
    if (pending.length > MAX_PENDING) pending = pending.slice(-MAX_PENDING);
  }

  function recordView(at: number): void {
    if (!openView) return;
    push(
      { kind: "view", dwellMs: ms(at - openView.at) },
      openView.at,
      openView.seq,
    );
    openView = null;
  }

  return {
    routeChanged(next) {
      if (next === route) return;
      const at = now();
      recordView(at);
      if (
        route !== null &&
        left?.route === next &&
        at - left.at <= BOUNCE_WINDOW_MS
      ) {
        push({ kind: "signal", signal: "nav_bounce", element: null }, at);
      }
      left = route === null ? null : { route, at };
      route = next;
      openView = { seq: seq++, at };
    },

    hidden() {
      recordView(now());
    },

    click(element) {
      const at = now();
      push({ kind: "action", element }, at);
      recentClicks = [
        ...recentClicks.filter(
          (c) => c.element === element && at - c.at < RAGE_WINDOW_MS,
        ),
        { element, at },
      ];
      if (recentClicks.length === RAGE_CLICKS) {
        push({ kind: "signal", signal: "rage_click", element }, at);
      }
      lastClick = { element, at };
    },

    signal(signal, element, durationMs) {
      push({
        kind: "signal",
        signal,
        element,
        ...(durationMs === undefined ? {} : { durationMs: ms(durationMs) }),
      });
    },

    errorShown(element) {
      const at = now();
      const cause =
        element ??
        (lastClick && at - lastClick.at <= ERROR_ATTRIBUTION_MS
          ? lastClick.element
          : null);
      push({ kind: "signal", signal: "error_shown", element: cause }, at);
    },

    flowStep(flow, step) {
      push({ kind: "flow_step", flow, step });
    },

    drain(max) {
      const at = now();
      const batch = pending.slice(0, max);
      pending = pending.slice(max);
      return batch.map(
        (p) => ({ ...p.event, ageMs: ms(at - p.at) }) as UiEvent,
      );
    },

    size: () => pending.length,
  };
}
