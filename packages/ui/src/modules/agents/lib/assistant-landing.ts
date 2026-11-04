/**
 * UNIT_BOUNDARY_DESCRIPTION: whether this page load should open a chat instead
 * of the route it asked for: on Home, with an assistant the server says has
 * never been used. Both answers must have arrived — the install's mode decides
 * whether the row is asked for at all, so a missing second answer is not a
 * "no" — and then the one-shot is spent. The answer comes from the server, so a
 * sleeping assistant is decided without waking it.
 */
export function landingAssistantId(input: {
  view: string;
  listLoaded: boolean;
  stateLoaded: boolean;
  assistantId: string | null;
  used: boolean | undefined;
}): { decide: false } | { decide: true; landIn: string | null } {
  if (input.view !== "home") return { decide: true, landIn: null };
  if (!input.listLoaded || !input.stateLoaded) return { decide: false };
  if (input.assistantId === null || input.used !== false)
    return { decide: true, landIn: null };
  return { decide: true, landIn: input.assistantId };
}
