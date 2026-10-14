import { useSyncExternalStore } from "react";

export type BudgetLayout =
  | "per-page"
  | "wrapper"
  | "rail"
  | "header"
  | "sticky-strip";

const LABELS: Record<BudgetLayout, string> = {
  "per-page": "1: Per-page",
  wrapper: "2: Wrapper",
  rail: "3: Sidebar",
  header: "4: Header",
  "sticky-strip": "5: Sticky strip",
};

let currentLayout: BudgetLayout = "per-page";
const listeners = new Set<() => void>();

export function getBudgetLayout(): BudgetLayout {
  return currentLayout;
}

export function setBudgetLayout(value: BudgetLayout) {
  currentLayout = value;
  listeners.forEach((fn) => fn());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot() {
  return currentLayout;
}

export function useBudgetLayout(): BudgetLayout {
  return useSyncExternalStore(subscribe, getSnapshot);
}

const OPTIONS: BudgetLayout[] = [
  "per-page",
  "wrapper",
  "rail",
  "header",
  "sticky-strip",
];

export function BudgetLayoutToggle() {
  const layout = useBudgetLayout();

  const cycle = () => {
    const idx = OPTIONS.indexOf(layout);
    setBudgetLayout(OPTIONS[(idx + 1) % OPTIONS.length]);
  };

  return (
    <button
      type="button"
      onClick={cycle}
      className="fixed bottom-4 right-48 z-[9999] flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-[14px] font-medium text-foreground shadow-lg transition-colors hover:bg-muted"
    >
      <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-400" />
      Budget: {LABELS[layout]}
    </button>
  );
}
