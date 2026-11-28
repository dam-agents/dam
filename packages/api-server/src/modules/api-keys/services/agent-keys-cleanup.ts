/**
 * UNIT_BOUNDARY_DESCRIPTION: What a deleted Agent leaves behind in the API
 * keys. A key that belongs to the Agent is its own identity at the platform
 * API, so it is revoked. A key of the owner that was bound to the Agent only
 * loses that binding, as before. The revoke runs first, so a key that belongs
 * to the Agent is never live with an empty binding in between.
 */
export function createAgentKeysCleanup(deps: {
  revokeOwn: (agentId: string) => Promise<void>;
  unbind: (agentId: string) => Promise<void>;
}): (agentId: string) => Promise<void> {
  return async (agentId) => {
    await deps.revokeOwn(agentId);
    await deps.unbind(agentId);
  };
}
