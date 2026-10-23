/**
 * Home page fixture scenarios.
 * The active scenario drives which fixture data each STUB hook returns.
 */

export type HomeScenario =
  | "morning-return"
  | "all-clear"
  | "first-run"
  | "single-blocked"
  | "heavy-load"
  | "experiments-only"
  | "kb-only"
  | "everything-broken";

export const SCENARIO_OPTIONS: { value: HomeScenario; label: string }[] = [
  { value: "morning-return", label: "Morning return" },
  { value: "all-clear", label: "All clear" },
  { value: "first-run", label: "First run (empty)" },
  { value: "single-blocked", label: "Single blocked" },
  { value: "heavy-load", label: "Heavy load" },
  { value: "experiments-only", label: "Experiments only" },
  { value: "kb-only", label: "KB only" },
  { value: "everything-broken", label: "Everything broken" },
];

let activeScenario: HomeScenario = "morning-return";
let listeners: Array<() => void> = [];

function emit() {
  for (const l of listeners) l();
}

export function getActiveScenario(): HomeScenario {
  return activeScenario;
}

export function setActiveScenario(s: HomeScenario) {
  activeScenario = s;
  emit();
}

export function subscribeScenario(cb: () => void) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}
