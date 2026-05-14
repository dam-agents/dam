/**
 * Exit codes used by the instance verbs. The cli module's exit-codes.ts
 * owns the contract for shared codes (0/1/2/3); these names re-export
 * the same numbers so a future merge with that file would be mechanical.
 */
export const EXIT_INSTANCE_SUCCESS = 0;
export const EXIT_INSTANCE_RUNTIME_FAILURE = 1;
export const EXIT_INSTANCE_INVALID_INPUT = 2;
export const EXIT_INSTANCE_BELOW_FLOOR = 3;

/**
 * Resolver couldn't pin down which Instance was meant: not-found OR
 * ambiguous. Shared by both kinds so wrapper scripts don't need to
 * branch on "did you mean a different one" vs "no such instance".
 *
 * `4` is taken by `EXIT_AUTH_STATUS_NO_VALID`; using `5` keeps the
 * cross-module exit-code space orthogonal even though each module's
 * namespace is technically independent.
 */
export const EXIT_INSTANCE_NOT_RESOLVED = 5;
