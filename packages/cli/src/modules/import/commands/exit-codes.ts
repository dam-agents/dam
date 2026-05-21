export {
  EXIT_SUCCESS as EXIT_IMPORT_SUCCESS,
  EXIT_RUNTIME_FAILURE as EXIT_IMPORT_RUNTIME_FAILURE,
  EXIT_INVALID_INPUT as EXIT_IMPORT_INVALID_INPUT,
  EXIT_BELOW_FLOOR as EXIT_IMPORT_BELOW_FLOOR,
} from "../../shared/exit-codes.js";

export { EXIT_AGENT_NOT_RESOLVED } from "../../agent/commands/exit-codes.js";

/** POSIX convention: 128 + SIGINT(2). Emitted by the bundle-builder SIGINT handler. */
export const EXIT_IMPORT_SIGINT = 130;
