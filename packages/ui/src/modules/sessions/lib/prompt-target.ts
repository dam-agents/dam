/** The session a send may prompt, or why it may not. */
export type PromptTarget =
  | { ok: true; sessionId: string }
  | { ok: false; reason: string };

/** Whether the connection that came back is bound to the session this send asked
 *  for. Engagement reads the store when it resolves, not when the send started,
 *  so a sidebar click mid-flight can hand back a different session — and
 *  prompting that one delivers the message into another conversation (#2963). */
export function resolvePromptTarget(
  intendedSessionId: string,
  engagedSessionId: string,
): PromptTarget {
  if (engagedSessionId === intendedSessionId) {
    return { ok: true, sessionId: intendedSessionId };
  }
  return {
    ok: false,
    reason:
      "Couldn't send — the conversation changed while the message was on its way.",
  };
}
