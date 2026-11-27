/**
 * UNIT_BOUNDARY_DESCRIPTION: the sidebar's agent view follows only the
 * user's clicks in the sidebar, except when the chat moves to another
 * Agent from outside it, by a link, a notification or the palette: then the
 * view goes back to All agents, so the open Session is always one the list
 * can hold. A chat closed for another page leaves the view as it is.
 */
export function sidebarAgentAfterShown(
  sidebarAgent: string | null,
  shownAgent: string | null,
): string | null {
  return sidebarAgent !== null &&
    shownAgent !== null &&
    shownAgent !== sidebarAgent
    ? null
    : sidebarAgent;
}
