/**
 * UNIT_BOUNDARY_DESCRIPTION: The words and the steps of "Reset user onboarding":
 * it starts the person's own onboarding over — the assistant greets them as on
 * their first open and the Get started checklist begins again, with nothing
 * deleted — and then routes them through the app's own entry route so the
 * first-open landing decides, with every query behind it freshly answered.
 */
export const RESET_ONBOARDING_TITLE = "Reset user onboarding?";

export function resetOnboardingBody(assistantName: string): string {
  return `${assistantName} greets you as on your first open again, and the Get started checklist starts over. Nothing is deleted: not your assistant, its chats or its files.`;
}

export async function runResetOnboarding(deps: {
  assistantName: string;
  confirm: (
    body: string,
    title: string,
    options: { confirmLabel: string },
  ) => Promise<boolean>;
  reset: () => Promise<unknown>;
  refresh: () => Promise<unknown>;
  releaseLanding: () => void;
  goHome: () => void;
}): Promise<boolean> {
  const confirmed = await deps.confirm(
    resetOnboardingBody(deps.assistantName),
    RESET_ONBOARDING_TITLE,
    { confirmLabel: "Reset" },
  );
  if (!confirmed) return false;
  await deps.reset();
  await deps.refresh();
  deps.releaseLanding();
  deps.goHome();
  return true;
}
