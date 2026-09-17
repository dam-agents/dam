import type { OnboardingStep } from "api-server-api";

export type OnboardingStepInput = Pick<OnboardingStep, "id" | "label">;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The agent's own account of its onboarding, as a
 * list it may reshape while the conversation runs. Replacing the list keeps
 * the tick on every step that survives by id, so adding, renaming or
 * dropping a step never un-does work already reported; ticking is by id and
 * idempotent, and a tick for a step the list does not hold is refused rather
 * than invented.
 */
export function replaceChecklist(
  previous: readonly OnboardingStep[] | null,
  steps: readonly OnboardingStepInput[],
): OnboardingStep[] {
  const done = new Set((previous ?? []).filter((s) => s.done).map((s) => s.id));
  return steps.map((s) => ({ id: s.id, label: s.label, done: done.has(s.id) }));
}

export function completeStep(
  previous: readonly OnboardingStep[],
  id: string,
): OnboardingStep[] | null {
  if (!previous.some((s) => s.id === id)) return null;
  return previous.map((s) => (s.id === id ? { ...s, done: true } : s));
}

export function duplicateStepId(
  steps: readonly OnboardingStepInput[],
): string | null {
  const seen = new Set<string>();
  for (const s of steps) {
    if (seen.has(s.id)) return s.id;
    seen.add(s.id);
  }
  return null;
}
