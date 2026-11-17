export const SECURITY_CHECK_DISMISS_HINT =
  "Hides this alert. The next check tells you again about what is still unsafe.";

export const SECURITY_CHECK_OPEN_LABEL = "Review in chat";

export function securityCheckHeadline(problemCount: number): string {
  return problemCount === 1
    ? "Your setup has 1 security problem"
    : `Your setup has ${String(problemCount)} security problems`;
}
