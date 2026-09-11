/**
 * UNIT_BOUNDARY_DESCRIPTION: How a credential is spelled in the store. A ref
 * path is an owner and a name, and the owner is whatever the identity provider
 * calls a person — so it is escaped rather than trusted to be path-shaped.
 *
 * One definition, because a path is an opaque key: whoever writes a row and
 * whoever later reads it have to spell it the same way, and a second escaping
 * rule that merely agrees for the identifiers seen so far is a credential that
 * cannot be found the first time it does not.
 */
export function pathSafe(value: string): string {
  return value.replace(
    /[^A-Za-z0-9._-]/g,
    (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );
}
