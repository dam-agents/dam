import { timingSafeEqual } from "node:crypto";

// UNIT_BOUNDARY_DESCRIPTION: whether a call to the access check carries the install's shared secret, compared in constant time. An install with no secret set answers no to every call, so the check can never run open.
export function bearerMatches(
  header: string | undefined,
  secret: string,
): boolean {
  if (secret === "" || header === undefined) return false;
  const [scheme, token] = header.split(" ", 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) return false;
  const given = Buffer.from(token, "utf8");
  const expected = Buffer.from(secret, "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
