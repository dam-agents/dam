export type { TransportError, AuthRequiredError } from "../../shared/errors.js";

/** The Slack channel id is already bound to a different Agent (server CONFLICT). */
export interface ChannelConflictError {
  kind: "channel-conflict";
  message: string;
}

/** The operator hasn't enabled this provider on the host (server
 *  PRECONDITION_FAILED). Normally caught by the client-side `available`
 *  precheck; this is the defensive fallback when the mutation returns it. */
export interface ChannelPreconditionError {
  kind: "channel-precondition";
  message: string;
}

/** The server rejected the binding input (TRPCError BAD_REQUEST) — carries the
 *  server's message so the command surfaces it and exits `EXIT_INVALID_INPUT`
 *  instead of misclassifying it as a transport failure. */
export interface ChannelInvalidInputError {
  kind: "invalid-input";
  message: string;
}
