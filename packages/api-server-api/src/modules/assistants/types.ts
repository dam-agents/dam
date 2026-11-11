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
  /* UNIT_BOUNDARY_DESCRIPTION: whether the platform finished making this Agent. A record the platform wrote and has not settled is a create still running behind the request that started it, which the client waits out rather than reading as an assistant it does not have. */
  ready: boolean;
}

export interface AssistantsService {
  state(): Promise<AssistantState | null>;
  /**
   * UNIT_BOUNDARY_DESCRIPTION: the person's one onboarding reset, which Settings ›
   * Experimental features offers as a single button. The Get started checklist
   * starts over — every avatar locked again — and when the feature is on for them
   * the assistant counts as never used again, so the first landing and the
   * greeting come back, with an assistant they deleted made again when the name is
   * free. Nothing is deleted — not the assistant, its sessions or its files — and
   * a person the feature is off for gets the checklist alone.
   */
  resetOnboarding(): Promise<void>;
}
