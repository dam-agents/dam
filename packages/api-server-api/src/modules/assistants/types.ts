import type { z } from "zod";

import type {
  assistantFirstResultInputSchema,
  firstResultKindSchema,
} from "./schemas.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The kinds of first result the assistant may report:
 * the three things the onboarding design counts as the person having got
 * something out of the platform — a schedule set, an artifact made, a saved
 * knowledge base.
 */
export type FirstResultKind = z.infer<typeof firstResultKindSchema>;

export type AssistantFirstResultInput = z.infer<
  typeof assistantFirstResultInputSchema
>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The first result the person's onboarding reached,
 * recorded once: its kind, the reference the assistant gave it (an Agent, session
 * or artifact name, as that kind allows — null when it named none), and when it
 * landed.
 */
export interface AssistantFirstResult {
  kind: FirstResultKind;
  ref: string | null;
  at: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: What the UI needs to know about the owner's
 * assistant without waking it: which Agent it is, whether it has ever been used —
 * the first landing in its chat and the greeting rest on that — when the person's
 * onboarding was last reset, which is the epoch a tab's own unconfirmed mark is
 * read against, which cohort the account was in when the platform made it one,
 * and the first result their onboarding reached, which is what says the
 * onboarding is done.
 */
export interface AssistantState {
  agentId: string;
  /**
   * UNIT_BOUNDARY_DESCRIPTION: whether the account had an Agent of its own before
   * the platform gave it this one, decided once when it first did and never
   * recomputed, so no delete, reset or new assistant moves an account between the
   * cohort that knew the platform before its assistant and the one onboarded with
   * it.
   */
  legacy: boolean;
  used: boolean;
  resetAt: string | null;
  /* UNIT_BOUNDARY_DESCRIPTION: whether the platform finished making this Agent. A record the platform wrote and has not settled is a create still running behind the request that started it, which the client waits out rather than reading as an assistant it does not have. */
  ready: boolean;
  firstResult: AssistantFirstResult | null;
}

export interface AssistantsService {
  state(): Promise<AssistantState | null>;
  /**
   * UNIT_BOUNDARY_DESCRIPTION: records the first result the assistant says the
   * person reached — a schedule set, an artifact made, a saved knowledge base —
   * once per account: a later report is a no-op answered with the first one, so
   * nothing the person did afterwards moves the moment their onboarding finished.
   * It is the caller's own record that is written, and the checklist counts the
   * task the kind names as done and seen, as the platform records what it did for
   * them rather than what they did.
   */
  recordFirstResult(
    input: AssistantFirstResultInput,
  ): Promise<AssistantFirstResult | null>;
  /**
   * UNIT_BOUNDARY_DESCRIPTION: the person's one onboarding reset, which Settings ›
   * Experimental features offers as a single button. The Get started checklist
   * starts over — every avatar locked again — and when the feature is on for them
   * the assistant counts as never used again, so the first landing and the
   * greeting come back, with an assistant they deleted made again when the name is
   * free. Nothing is deleted — not the assistant, its sessions or its files — and
   * a person the feature is off for gets the checklist alone. The first result is
   * forgotten with it: onboarding starts over.
   */
  resetOnboarding(): Promise<void>;
}
