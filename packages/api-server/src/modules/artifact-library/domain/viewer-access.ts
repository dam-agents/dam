import type { ShareSession } from "./share-session.js";

export type ViewDecision = "allow" | "deny";

export function normalizeViewerEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function decideRestrictedView(
  artifact: { owner: string },
  session: ShareSession,
  viewers: readonly string[],
): ViewDecision {
  if (session.sub === artifact.owner) return "allow";
  if (!session.emailVerified || session.email === null) return "deny";
  return viewers.includes(normalizeViewerEmail(session.email))
    ? "allow"
    : "deny";
}
