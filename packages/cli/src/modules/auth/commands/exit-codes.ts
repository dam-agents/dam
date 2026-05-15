/**
 * Exit codes used by the auth verbs. The cli module's exit-codes.ts owns
 * the contract for shared codes (0/1/2/3); these names re-export the
 * same numbers so a future merge with that file would be mechanical.
 */
export const EXIT_AUTH_SUCCESS = 0;
export const EXIT_AUTH_RUNTIME_FAILURE = 1;
export const EXIT_AUTH_INVALID_INPUT = 2;
export const EXIT_AUTH_BELOW_FLOOR = 3;
/**
 * `dam auth status`: active host has no valid credentials. Distinct from
 * `EXIT_AUTH_RUNTIME_FAILURE` so wrapper scripts can branch on "need to
 * re-authenticate" vs "the CLI itself crashed reading the store".
 */
export const EXIT_AUTH_STATUS_NO_VALID = 4;
