/**
 * UNIT_BOUNDARY_DESCRIPTION: whether this page load should open a chat instead
 * of the route it asked for: on Home, with an assistant the server says has
 * never been used. The answer comes from the server, so a sleeping assistant is
 * decided without waking it, and Home stays Home for everyone else.
 */
export function landingAssistantId(input: {
  view: string;
  assistantId: string | null;
  used: boolean | undefined;
}): string | null {
  if (input.view !== "home" || input.assistantId === null) return null;
  if (input.used !== false) return null;
  return input.assistantId;
}
