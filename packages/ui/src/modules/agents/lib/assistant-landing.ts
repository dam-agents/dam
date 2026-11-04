/**
 * UNIT_BOUNDARY_DESCRIPTION: whether this page load should open a chat instead
 * of the route it asked for: on Home, with an assistant that exists and no
 * session of its own yet. An assistant whose list is still loading decides
 * nothing, and Home stays Home for everyone else.
 */
export function landingAssistantId(input: {
  view: string;
  assistantId: string | null;
  sessions: readonly unknown[] | undefined;
}): string | null {
  if (input.view !== "home" || input.assistantId === null) return null;
  if (input.sessions === undefined) return null;
  return input.sessions.length === 0 ? input.assistantId : null;
}
