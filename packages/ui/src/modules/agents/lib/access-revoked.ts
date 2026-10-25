/**
 * UNIT_BOUNDARY_DESCRIPTION: The close code the api-server sends on every
 * socket an Agent Editor holds open to a Shared Agent when the owner takes
 * them off its Editor List. A socket closed this way must not reconnect: the
 * agents list drops the agent and sends the person home instead.
 */
export const ACCESS_REVOKED_CLOSE_CODE = 4403;

export function isAccessRevokedClose(code: number | undefined): boolean {
  return code === ACCESS_REVOKED_CLOSE_CODE;
}
