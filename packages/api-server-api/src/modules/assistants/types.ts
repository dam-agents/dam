/**
 * UNIT_BOUNDARY_DESCRIPTION: What the UI needs to know about the owner's
 * assistant without waking it: which Agent it is, whether it has ever been used —
 * the first landing in its chat and the greeting rest on that — and when the
 * person's onboarding was last reset, which is the epoch a tab's own unconfirmed
 * mark is read against.
 */
export interface AssistantState {
  agentId: string;
  used: boolean;
  resetAt: string | null;
}

export interface AssistantsService {
  state(): Promise<AssistantState | null>;
  /**
   * UNIT_BOUNDARY_DESCRIPTION: starts this person's onboarding over: the
   * assistant counts as never used again, so the first landing and the greeting
   * come back, and the Get started checklist resets through the same reset its
   * own button uses. Nothing is deleted — not the assistant, its sessions or its
   * files — and an assistant the person deleted is created again, so there is
   * something to greet them with. Refused while the feature is off for them.
   */
  resetOnboarding(): Promise<void>;
}
