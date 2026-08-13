export type PromptTarget =
  | { ok: true; sessionId: string }
  | { ok: false; reason: string };

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
