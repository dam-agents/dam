/**
 * UNIT_BOUNDARY_DESCRIPTION: The one-time news that provisioning an assistant
 * renamed another of the owner's Agents to make room for the reserved name. It
 * names both names, and stays until the owner dismisses it.
 */
export interface AssistantNotice {
  renamedFrom: string;
  renamedTo: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: What the UI needs to know about the owner's
 * assistant without waking it: which Agent it is, whether it has ever been used
 * — the first landing in its chat rests on that — and the notice above.
 */
export interface AssistantState {
  agentId: string;
  used: boolean;
  notice: AssistantNotice | null;
}

export interface AssistantsService {
  state(): Promise<AssistantState | null>;
  dismissNotice(): Promise<void>;
  /**
   * UNIT_BOUNDARY_DESCRIPTION: starts this person's onboarding over: the
   * assistant counts as never used again, so the first landing and the greeting
   * come back, and the Get started checklist resets through the same reset its
   * own button uses. It deletes nothing — not the assistant, its sessions or
   * files — and leaves the one-time rename news as it was. Success when the
   * person has no assistant yet, and refused while the feature is off for them.
   */
  resetOnboarding(): Promise<void>;
}
