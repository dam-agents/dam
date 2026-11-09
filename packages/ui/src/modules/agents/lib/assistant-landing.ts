/**
 * UNIT_BOUNDARY_DESCRIPTION: whether this page load should open a chat instead
 * of the route it asked for: on Home, with the feature on for the person, and an
 * assistant the server says has never been used. Every answer must have arrived — the feature's own answer,
 * the agent list and the record — because a missing one is not a "no", and the
 * person who just reset their onboarding must be routed on what the server says
 * now, never on what the cache said before. Then the one-shot is spent. The
 * answer comes from the server, so a sleeping assistant is decided without
 * waking it.
 */
export function landingAssistantId(input: {
  view: string;
  gateKnown: boolean;
  assistantOn: boolean;
  listLoaded: boolean;
  stateLoaded: boolean;
  assistantId: string | null;
  used: boolean | undefined;
}): { decide: false } | { decide: true; landIn: string | null } {
  if (input.view !== "home") return { decide: true, landIn: null };
  if (!input.gateKnown || !input.listLoaded || !input.stateLoaded)
    return { decide: false };
  if (!input.assistantOn || input.assistantId === null || input.used !== false)
    return { decide: true, landIn: null };
  return { decide: true, landIn: input.assistantId };
}
