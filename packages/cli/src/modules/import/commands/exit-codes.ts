// Mirrors the convention in cli/ and agent/ exit-codes.ts.
export const EXIT_IMPORT_SUCCESS = 0;
export const EXIT_IMPORT_RUNTIME_FAILURE = 1;
export const EXIT_IMPORT_INVALID_INPUT = 2;
export const EXIT_IMPORT_BELOW_FLOOR = 3;
export const EXIT_AGENT_NOT_RESOLVED = 5;
/** POSIX convention: 128 + SIGINT(2). Emitted by the bundle-builder SIGINT handler. */
export const EXIT_IMPORT_SIGINT = 130;
