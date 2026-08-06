/** The session a send is allowed to prompt, given what it asked for and what
 *  the connection actually engaged. */
export type PromptTarget =
  | { ok: true; sessionId: string }
  | { ok: false; reason: string };

/** What engaging a connection produced: the bound session, and whether this
 *  engagement minted it rather than resuming an existing one. */
export interface EngagedSession {
  sessionId: string;
  created: boolean;
}

/**
 * Decide whether the engaged session is the one this send may prompt.
 *
 * A send captures its intended session *before* awaiting the transport, because
 * a sidebar click during that round trip repoints the shared connection at
 * whatever session the user opened. Engagement commits the session to the
 * store, so afterwards "the session I asked for" and "the session the view
 * moved to" are indistinguishable by id alone — `created` is the only thing
 * that separates them. A send that asked for a fresh session therefore insists
 * on having been the one to create it; a send for an existing session insists
 * on that exact id.
 *
 * Getting this wrong is not a display bug: the prompt is delivered to another
 * conversation, appended to its log, and answered there with its context.
 */
export function resolvePromptTarget(
  intendedSessionId: string | null,
  engaged: EngagedSession,
): PromptTarget {
  if (intendedSessionId === null) {
    if (engaged.created) return { ok: true, sessionId: engaged.sessionId };
    return {
      ok: false,
      reason:
        "Couldn't start the new session — the conversation changed before it was created.",
    };
  }
  if (engaged.sessionId === intendedSessionId) {
    return { ok: true, sessionId: intendedSessionId };
  }
  return {
    ok: false,
    reason:
      "Couldn't send — the conversation changed while the message was on its way.",
  };
}
