import type { UserIdentity } from "../../context.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The email a signed-in person matches an Editor
 * List by. Only a verified email of a person who signed in counts: an API key
 * is never an Agent Editor, and an unverified email could name anyone.
 */
export function editorEmailOf(user: UserIdentity): string | null {
  if (user.keyId !== undefined) return null;
  if (user.emailVerified !== true || !user.email) return null;
  return user.email.trim().toLowerCase();
}
