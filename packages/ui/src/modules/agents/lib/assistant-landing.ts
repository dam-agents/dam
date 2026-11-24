/**
 * UNIT_BOUNDARY_DESCRIPTION: whether this page load should open a chat instead
 * of the route it asked for: on Home, with the feature on for the person, and an
 * assistant the server says has never been used and that the platform has finished
 * making. Every answer must have arrived — the feature's own answer, the agent
 * list and a settled record — because a missing one is not a "no", and the person
 * who just reset their onboarding must be routed on what the server says now,
 * never on what the cache said before. Then the one-shot is spent. The
 * answer comes from the server, so a sleeping assistant is decided without
 * waking it.
 * Landing in its chat is the **first open**: a person who owns an Agent of their
 * own keeps the landing their account has, and meets the assistant in the list.
 * The onboarding reset is the one ask that lands them there anyway.
 */
export function landingAssistantId(input: {
  view: string;
  gateKnown: boolean;
  assistantOn: boolean;
  listLoaded: boolean;
  stateLoaded: boolean;
  recordReady: boolean;
  assistantId: string | null;
  used: boolean | undefined;
  ownsOtherAgents: boolean;
  afterReset: boolean;
}): { decide: false } | { decide: true; landIn: string | null } {
  if (input.view !== "home") return { decide: true, landIn: null };
  if (!input.gateKnown || !input.listLoaded || !input.stateLoaded)
    return { decide: false };
  if (!input.assistantOn) return { decide: true, landIn: null };
  /* UNIT_BOUNDARY_DESCRIPTION: the platform makes an assistant behind the request that asks for one, so a record it has not settled — none yet, or one still `creating` — is a create that may land in a moment. Waiting it out spends nothing and blocks nothing: the person is on Home, and the one-shot is still there when the record turns ready. */
  if (!input.recordReady) return { decide: false };
  if (input.assistantId === null || input.used !== false)
    return { decide: true, landIn: null };
  if (input.ownsOtherAgents && !input.afterReset)
    return { decide: true, landIn: null };
  return { decide: true, landIn: input.assistantId };
}
