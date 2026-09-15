import type { Pack } from "../data/packs.js";

export interface OnboardingStep {
  id: string;
  label: string;
  done: boolean;
}

export interface OnboardingState {
  packId: string;
  packName: string;
  steps: OnboardingStep[];
  completed: boolean;
}

export function buildOnboardingSteps(pack: Pack): OnboardingStep[] {
  const steps: OnboardingStep[] = [];
  const seen = new Set<string>();

  for (const slot of pack.required) {
    if (slot.kind === "connection" && !seen.has(`connect-${slot.label}`)) {
      seen.add(`connect-${slot.label}`);
      steps.push({
        id: `connect-${slot.label}`,
        label: `Connect ${slot.label}`,
        done: false,
      });
    }
  }

  const hasSchedule = [...pack.included, ...pack.required].some(
    (s) => s.kind === "schedule",
  );
  if (hasSchedule) {
    steps.push({ id: "schedule", label: "Configure schedule", done: false });
  }

  steps.push({ id: "first-run", label: "Run first session", done: false });
  return steps;
}

export function isOnboardingComplete(steps: OnboardingStep[]): boolean {
  return steps.length > 0 && steps.every((s) => s.done);
}
