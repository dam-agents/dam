export interface GrantedCredential {
  connectionId: string;
  credentialId: string;
}

// UNIT_BOUNDARY_DESCRIPTION: the credentials an Agent's gateway is told about, for the Connections it is granted now. A credential stored for a Connection the Agent no longer holds is left out, so the gateway is never told of a credential for a grant that is gone. The order is the Connections', so the same grants always give the same list and the gateway does not re-render for nothing.
export function grantedCredentialsOf(
  connectionIds: readonly string[],
  stored: readonly GrantedCredential[],
): GrantedCredential[] {
  const byConnection = new Map(
    stored.map((c) => [c.connectionId, c.credentialId]),
  );
  return connectionIds.flatMap((connectionId) => {
    const credentialId = byConnection.get(connectionId);
    return credentialId === undefined ? [] : [{ connectionId, credentialId }];
  });
}
