/**
 * UNIT_BOUNDARY_DESCRIPTION: The words and the steps of the one onboarding reset,
 * the card at the bottom of Settings › Experimental features. It restarts the Get
 * started checklist — every avatar locked again, the assistant's own create task
 * recorded as a first open records it — and, for a person the assistant is on for,
 * gives them a first open in it too: the greeting comes back and a Dambledore they
 * deleted is made again. Nothing in their account is deleted.
 * A person it is off for gets the checklist alone, so the app is not taken to the
 * entry route on their account: only a first open is routed.
 */
export const RESET_ONBOARDING_TITLE = "Restart your onboarding?";

export const RESET_ONBOARDING_BODY =
  "Every avatar locks again and the Get started checklist starts over. Avatars already on your agents stay, and nothing in your account is deleted.";

export async function runResetOnboarding(deps: {
  confirm: (
    body: string,
    title: string,
    options: { confirmLabel: string },
  ) => Promise<boolean>;
  /* UNIT_BOUNDARY_DESCRIPTION: whether the assistant is on for this person, which is what decides whether they are routed as a first-timer afterwards. */
  onboard: boolean;
  reset: () => Promise<unknown>;
  refresh: () => Promise<unknown>;
  releaseLanding: () => void;
  goHome: () => void;
}): Promise<boolean> {
  const confirmed = await deps.confirm(
    RESET_ONBOARDING_BODY,
    RESET_ONBOARDING_TITLE,
    {
      confirmLabel: "Restart",
    },
  );
  if (!confirmed) return false;
  await deps.reset();
  await deps.refresh();
  if (!deps.onboard) return true;
  deps.releaseLanding();
  deps.goHome();
  return true;
}
