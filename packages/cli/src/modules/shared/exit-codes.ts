/**
 * Process exit codes emitted by the `dam` CLI.
 *
 * One flat table — exit codes are a contract with the user's shell, not a
 * per-module concern, so every command imports from here directly.
 */

export const EXIT_SUCCESS = 0;
export const EXIT_RUNTIME_FAILURE = 1;
export const EXIT_INVALID_INPUT = 2;
export const EXIT_BELOW_FLOOR = 3;

/** `dam auth status` — at least one configured host has no valid token. */
export const EXIT_AUTH_STATUS_NO_VALID = 4;

/** Agent ref didn't resolve — zero matches or ambiguous. */
export const EXIT_AGENT_NOT_RESOLVED = 5;

/** `dam network update` against an unknown rule ID (revoke is idempotent — exits 0). */
export const EXIT_RULE_NOT_FOUND = 6;

/** POSIX convention: 128 + SIGINT(2). Emitted on Ctrl+C during bundle pack/upload. */
export const EXIT_SIGINT = 130;
