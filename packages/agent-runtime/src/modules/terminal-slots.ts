/**
 * UNIT_BOUNDARY_DESCRIPTION: A harness that starts a new session inside a
 * running terminal (Claude Code's /clear) keeps the same PTY. The PTY slot is
 * found by the terminal id handed to that PTY, not by its session id, because
 * the session id changes on every move. The slot is re-keyed under the new
 * session id, so the old session is left without a PTY and resumes its own
 * transcript in a fresh one when it is opened again.
 */
export function moveTerminalSlot<
  T extends { sessionId: string; terminalId: string },
>(slots: Map<string, T>, terminalId: string, sessionId: string): T | null {
  const slot = [...slots.values()].find((s) => s.terminalId === terminalId);
  if (!slot || slots.has(sessionId)) return null;
  slots.delete(slot.sessionId);
  slot.sessionId = sessionId;
  slots.set(sessionId, slot);
  return slot;
}
