export interface DerivedCredential {
  connectionId: string;
  key: string;
}

// UNIT_BOUNDARY_DESCRIPTION: the derived credentials an Agent's gateway is told about, for the Connections it is granted now. A key stored for a Connection the Agent no longer holds is left out, so the gateway is never told of a derived credential for a grant that is gone. The order is the Connections', so the same grants always give the same list and the gateway does not re-render for nothing.
export function derivedCredentialsOf(
  connectionIds: readonly string[],
  stored: readonly DerivedCredential[],
): DerivedCredential[] {
  const byConnection = new Map(stored.map((d) => [d.connectionId, d.key]));
  return connectionIds.flatMap((connectionId) => {
    const key = byConnection.get(connectionId);
    return key === undefined ? [] : [{ connectionId, key }];
  });
}
