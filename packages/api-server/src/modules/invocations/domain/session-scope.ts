/**
 * UNIT_BOUNDARY_DESCRIPTION: which of a Driver's running Invocations a chat of
 * that Driver shows. A chat shows the ones its own Session spawned, and every
 * one with no recorded Session (a script run outside a Session, a harness
 * that does not name its Session, a row from before the platform kept it), so
 * nothing that showed before disappears. A chat with no Session yet spawned
 * nothing of its own.
 */
export function shownInSession(
  invocation: { driverSessionId: string | null },
  sessionId: string | null,
): boolean {
  return (
    invocation.driverSessionId === null ||
    invocation.driverSessionId === sessionId
  );
}
