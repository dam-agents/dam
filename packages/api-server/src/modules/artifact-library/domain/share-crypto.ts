import { randomBytes, randomUUID } from "node:crypto";

/** URL-safe public slug — the entire capability for reaching a shared
 *  artifact, so it must be unguessable. 80 bits from the CSPRNG, base64url.
 *  There is deliberately no second factor (no passwords): whoever holds the
 *  link may view, and guarding the link is the sharer's responsibility. */
export function generateSlug(): string {
  return randomBytes(10).toString("base64url");
}

export function generateId(): string {
  return randomUUID();
}
